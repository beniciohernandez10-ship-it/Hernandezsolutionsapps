import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem, withUser } from "@/lib/db";
import { setConfigForTesting } from "@/lib/config";
import { processJobs } from "@/lib/jobs";
import { addMessage, createTicket, getTicket, listTickets, updateTicket } from "@/lib/tickets/service";
import { getPreferences, listNotifications, markRead, unreadCount, updatePreferences } from "@/lib/notify/service";
import { setResendFetchForTesting } from "@/lib/email/resend";
import { applySlaTransition, sweepSla } from "@/lib/sla/service";
import { assignSlaPolicy, listSlaPolicies, saveSlaPolicy } from "@/lib/sla/admin";
import { MemoryStorage, setStorageForTesting } from "@/lib/attachments/storage";
import { openAttachment, uploadAttachment } from "@/lib/attachments/service";
import {
  convertInbound,
  discardInbound,
  extractReply,
  ingestInboundEmail,
  listInbox,
  recordInboundWebhook,
  verifySvixSignature,
} from "@/lib/email/inbound";

const U = DEMO.users;
const C = DEMO.customers.contoso;
const F = DEMO.customers.fabrikam;
const SECRET = `whsec_${Buffer.from("test-webhook-secret-0123456789").toString("base64")}`;
const ticketInput = (o: object = {}) => ({ title: "Printer offline", description: "Nothing prints", priority: "normal", category: "hardware", ...o });

/** Fake Resend API: records sent emails, serves received emails and attachments. */
const sent: { body: Record<string, unknown>; idempotencyKey: string | null }[] = [];
const received = new Map<string, Record<string, unknown>>();
const files = new Map<string, Uint8Array>();
const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.hostname === "api.resend.com" && url.pathname === "/emails") {
    sent.push({ body: JSON.parse(String(init?.body)), idempotencyKey: new Headers(init?.headers).get("idempotency-key") });
    return Response.json({ id: randomUUID() });
  }
  const m = /^\/emails\/receiving\/([^/]+)(\/attachments)?$/.exec(url.pathname);
  if (url.hostname === "api.resend.com" && m) {
    const e = received.get(m[1]);
    if (!e) return new Response("{}", { status: 404 });
    if (m[2]) return Response.json({ object: "list", data: (e.attachments as object[]) ?? [] });
    return Response.json(e);
  }
  if (url.hostname === "files.example.test") {
    const d = files.get(url.pathname);
    return d ? new Response(d as unknown as BodyInit) : new Response("", { status: 404 });
  }
  return new Response("unexpected", { status: 500 });
}) as typeof fetch;

function enableEmail(intake = true) {
  setConfigForTesting({
    appOrigin: "http://localhost:3000",
    demoMode: true,
    email: {
      resendApiKey: "re_test",
      from: "IT Center <support@example.test>",
      inboundDomain: intake ? "in.example.test" : undefined,
      webhookSecret: intake ? SECRET : undefined,
    },
  });
}

/** Demo users are never emailed; make two of them real-looking recipients. */
async function realUsers() {
  await asSystem((tx) => tx.query("update users set is_demo = false where id = any($1::uuid[])", [[U.contosoRequester, U.tech, U.manager]]));
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

beforeAll(async () => {
  await freshDatabase();
  setResendFetchForTesting(fakeFetch);
  setStorageForTesting(new MemoryStorage());
  await realUsers();
});

beforeEach(() => {
  sent.length = 0;
  enableEmail();
});

afterEach(async () => {
  await processJobs({ limit: 200 });
});

async function newTicket(as: string = U.contosoRequester, o: object = {}) {
  const p = await principal(as);
  return createTicket(p, ticketInput(o), randomUUID());
}

describe("notifications", () => {
  it("tells assigned staff about a new request, not the requester", async () => {
    const t = await newTicket();
    await processJobs({ limit: 50 });
    const tech = (await listNotifications(await principal(U.tech))).filter((n) => n.ticketId === t.id);
    const mgr = (await listNotifications(await principal(U.manager))).filter((n) => n.ticketId === t.id);
    const req = (await listNotifications(await principal(U.contosoRequester))).filter((n) => n.ticketId === t.id);
    expect(tech.map((n) => n.kind)).toEqual(["ticket_created"]);
    expect(mgr.map((n) => n.kind)).toEqual(["ticket_created"]);
    expect(req).toHaveLength(0);
    // Fabrikam staff never hear about Contoso.
    expect((await listNotifications(await principal(U.techFabrikam))).some((n) => n.ticketId === t.id)).toBe(false);
  });

  it("staff replies reach the requester; private notes never do", async () => {
    const t = await newTicket();
    const tech = await principal(U.tech);
    await updateTicket(tech, t.id, { expectedVersion: 1, assigneeUserId: U.tech });
    await addMessage(tech, t.id, { body: "Secret internal detail", visibility: "internal" });
    await addMessage(tech, t.id, { body: "We are looking into it", visibility: "public" });
    await processJobs({ limit: 50 });
    const req = (await listNotifications(await principal(U.contosoRequester))).filter((n) => n.ticketId === t.id);
    expect(req.map((n) => n.kind)).toEqual(["public_reply"]);
    // Emails carry no message text at all.
    const toRequester = sent.filter((s) => (s.body.to as string[])[0] === "riley@example.com" || JSON.stringify(s.body).includes(t.number.toString()));
    for (const s of sent) {
      expect(JSON.stringify(s.body)).not.toContain("Secret internal detail");
      expect(JSON.stringify(s.body)).not.toContain("We are looking into it");
    }
    expect(toRequester.length).toBeGreaterThan(0);
  });

  it("assignment notifies the new assignee only", async () => {
    const t = await newTicket();
    await processJobs({ limit: 50 });
    const mgr = await principal(U.manager);
    await updateTicket(mgr, t.id, { expectedVersion: 1, assigneeUserId: U.tech });
    await processJobs({ limit: 50 });
    const kinds = (await listNotifications(await principal(U.tech))).filter((n) => n.ticketId === t.id).map((n) => n.kind);
    expect(kinds).toContain("assigned");
  });

  it("emails use an idempotency key and a reply address only where replies are allowed", async () => {
    const t = await newTicket();
    const tech = await principal(U.tech);
    await updateTicket(tech, t.id, { expectedVersion: 1, assigneeUserId: U.tech });
    await processJobs({ limit: 50 });
    sent.length = 0;
    await addMessage(tech, t.id, { body: "note", visibility: "internal" });
    await addMessage(await principal(U.manager), t.id, { body: "reply", visibility: "public" });
    await processJobs({ limit: 50 });
    const note = sent.find((s) => String(s.body.subject).includes("Private note"));
    const reply = sent.find((s) => String(s.body.subject).includes("New reply"));
    expect(note?.body.reply_to).toBeUndefined();
    expect(String(reply?.body.reply_to)).toMatch(/^t-[a-z0-9]+@in\.example\.test$/);
    for (const s of sent) expect(s.idempotencyKey).toMatch(/^notification-/);
  });

  it("respects email preferences but still records in-app", async () => {
    const p = await principal(U.contosoRequester);
    await updatePreferences(p, { emailEnabled: false, emailTicketUpdates: true, emailNewTickets: true, emailAssignments: true, emailSla: true });
    expect((await getPreferences(p)).emailEnabled).toBe(false);
    const t = await newTicket();
    await addMessage(await principal(U.tech), t.id, { body: "hello", visibility: "public" });
    sent.length = 0;
    await processJobs({ limit: 50 });
    expect((await listNotifications(p)).some((n) => n.ticketId === t.id && n.kind === "public_reply")).toBe(true);
    expect(sent.filter((s) => String(s.body.subject).includes(`#${t.number}]`) && String(s.body.subject).includes("New reply"))).toHaveLength(0);
    await updatePreferences(p, { emailEnabled: true, emailTicketUpdates: true, emailNewTickets: true, emailAssignments: true, emailSla: true });
  });

  it("marks read and hides notifications once access is revoked", async () => {
    const t = await newTicket(U.contosoRequester2);
    await addMessage(await principal(U.tech), t.id, { body: "hi", visibility: "public" });
    await processJobs({ limit: 50 });
    const p = await principal(U.contosoRequester2);
    expect(await unreadCount(p)).toBeGreaterThan(0);
    await markRead(p, { ticketId: t.id });
    expect((await listNotifications(p)).filter((n) => n.ticketId === t.id).every((n) => n.read)).toBe(true);
    await asSystem((tx) => tx.query("update memberships set revoked_at = now() where user_id = $1", [U.contosoRequester2]));
    expect(await listNotifications(await principal(U.contosoRequester2))).toHaveLength(0);
    await asSystem((tx) => tx.query("update memberships set revoked_at = null where user_id = $1", [U.contosoRequester2]));
  });

  it("customers cannot enqueue staff-only events directly", async () => {
    const t = await newTicket();
    await expect(withUser(U.contosoRequester, (tx) => tx.query("select app_enqueue_ticket_event($1, 'internal_note', null, null)", [t.id]))).rejects.toThrow();
    await expect(withUser(U.fabrikamRequester, (tx) => tx.query("select app_enqueue_ticket_event($1, 'public_reply', null, null)", [t.id]))).rejects.toThrow();
  });

  it("sends nothing by email when email is not configured", async () => {
    setConfigForTesting({ appOrigin: "http://localhost:3000", demoMode: true });
    const t = await newTicket();
    await addMessage(await principal(U.tech), t.id, { body: "hi", visibility: "public" });
    await processJobs({ limit: 50 });
    expect(sent).toHaveLength(0);
    expect((await listNotifications(await principal(U.contosoRequester))).some((n) => n.ticketId === t.id)).toBe(true);
  });
});

describe("SLAs", () => {
  let policyId: string;
  beforeAll(async () => {
    const op = await principal(U.operator);
    const allDay = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [["00:00", "24:00"]]]));
    policyId = (
      await saveSlaPolicy(op, null, {
        name: "Test 24x7",
        timeZone: "UTC",
        hours: allDay,
        holidays: [],
        targets: {
          urgent: { firstResponse: 30, resolution: 120 },
          high: { firstResponse: 60, resolution: 240 },
          normal: { firstResponse: 120, resolution: 480 },
          low: { firstResponse: 240, resolution: 960 },
        },
        warnPercent: 75,
      })
    ).id;
    await assignSlaPolicy(op, C, { policyId });
  });

  it("only operators manage policies, and invalid policies are rejected", async () => {
    await expectAppError(listSlaPolicies(await principal(U.manager)), 403);
    const op = await principal(U.operator);
    await expectAppError(saveSlaPolicy(op, null, { name: "Bad", timeZone: "Mars/Base", hours: {}, holidays: [], targets: {}, warnPercent: 75 }), 422);
    const list = await listSlaPolicies(op);
    expect(list.find((x) => x.id === policyId)?.customers.map((c) => c.id)).toEqual([C]);
    expect(list.some((x) => x.name.includes("suggested"))).toBe(true);
  });

  it("sets due times on new tickets and shows them to staff only", async () => {
    const t = await newTicket(U.contosoRequester, { priority: "high" });
    const staffView = await getTicket(await principal(U.tech), t.id);
    const custView = await getTicket(await principal(U.contosoRequester), t.id);
    expect(staffView.slaDetail?.policyName).toBe("Test 24x7");
    const created = new Date(staffView.createdAt).getTime();
    expect(new Date(staffView.slaDetail!.firstResponse.dueAt).getTime() - created).toBeGreaterThanOrEqual(60 * 60_000 - 1000);
    expect(new Date(staffView.slaDetail!.resolution.dueAt).getTime() - created).toBeLessThanOrEqual(240 * 60_000 + 1000);
    expect(custView.slaDetail).toBeNull();
    const custList = await listTickets(await principal(U.contosoRequester), { q: `#${t.number}` });
    expect(custList.items[0].sla).toBeNull();
    // Fabrikam has no policy.
    const f = await newTicket(U.fabrikamRequester);
    expect((await getTicket(await principal(U.manager), f.id)).slaDetail).toBeNull();
  });

  it("pauses while waiting on the customer and extends the due time on resume", async () => {
    const t = await newTicket();
    const before = await asSystem(async (tx) => (await tx.query("select resolution_due_at from tickets where id = $1", [t.id])).rows[0]);
    const t0 = new Date();
    await asSystem(async (tx) => {
      await tx.query("update tickets set status = 'waiting' where id = $1", [t.id]);
      await applySlaTransition(tx, t.id, { fromStatus: "open", toStatus: "waiting" }, t0);
      await tx.query("update tickets set status = 'open' where id = $1", [t.id]);
      await applySlaTransition(tx, t.id, { fromStatus: "waiting", toStatus: "open" }, new Date(t0.getTime() + 90 * 60_000));
    });
    const after = await asSystem(async (tx) => (await tx.query("select resolution_due_at, sla_paused_minutes, sla_paused_since from tickets where id = $1", [t.id])).rows[0]);
    expect(Number(after.sla_paused_minutes)).toBe(90);
    expect(after.sla_paused_since).toBeNull();
    expect(new Date(after.resolution_due_at as string).getTime() - new Date(before.resolution_due_at as string).getTime()).toBe(90 * 60_000);
  });

  it("customer reply resumes the clock through the normal service path", async () => {
    const t = await newTicket();
    const tech = await principal(U.tech);
    await updateTicket(tech, t.id, { expectedVersion: 1, status: "waiting" });
    expect((await asSystem((tx) => tx.query("select sla_paused_since from tickets where id = $1", [t.id]))).rows[0].sla_paused_since).not.toBeNull();
    await addMessage(await principal(U.contosoRequester), t.id, { body: "Here is the info", visibility: "public" });
    const row = (await asSystem((tx) => tx.query("select status, sla_paused_since from tickets where id = $1", [t.id]))).rows[0];
    expect(row.status).toBe("open");
    expect(row.sla_paused_since).toBeNull();
  });

  it("the sweep records each breach once, notifies staff, and hides it from the customer", async () => {
    const t = await newTicket();
    await processJobs({ limit: 50 });
    await asSystem((tx) =>
      tx.query("update tickets set first_response_due_at = now() - interval '1 minute', first_response_warn_at = now() - interval '2 minutes' where id = $1", [t.id]),
    );
    const first = await sweepSla();
    expect(first.filter((e) => e.ticketId === t.id).map((e) => `${e.kind}:${e.target}`)).toEqual(["sla_breached:first_response"]);
    expect((await sweepSla()).filter((e) => e.ticketId === t.id)).toHaveLength(0);
    const staff = await getTicket(await principal(U.tech), t.id);
    const cust = await getTicket(await principal(U.contosoRequester), t.id);
    expect(staff.events.some((e) => e.kind === "sla_breached")).toBe(true);
    expect(cust.events.some((e) => e.kind.startsWith("sla_"))).toBe(false);
    expect(staff.slaDetail?.firstResponse.state).toBe("breached");
    expect((await listTickets(await principal(U.tech), { q: `#${t.number}` })).items[0].sla).toBe("breached");
    // RLS hides SLA history from customers even with a direct query.
    const direct = await withUser(U.contosoRequester, (tx) => tx.query("select kind from ticket_events where ticket_id = $1", [t.id]));
    expect(direct.rows.some((r) => String(r.kind).startsWith("sla_"))).toBe(false);
  });
});

describe("attachments", () => {
  it("stores a valid file and lets only the right people download it", async () => {
    const t = await newTicket();
    const req = await principal(U.contosoRequester);
    const a = await uploadAttachment(req, { ticketId: t.id, filename: "screen.png", data: PNG, visibility: "public" });
    expect((await getTicket(req, t.id)).attachments.map((x) => [x.filename, x.scanStatus])).toEqual([["screen.png", "pending"]]);
    // Nobody can open it until the scan has run.
    await expectAppError(openAttachment(req, a.id), 404);
    await processJobs({ limit: 50 });
    expect((await getTicket(req, t.id)).attachments[0].scanStatus).toBe("clean");
    const own = await openAttachment(req, a.id);
    expect(own.info.contentType).toBe("image/png");
    expect((await openAttachment(await principal(U.tech), a.id)).info.id).toBe(a.id);
    await expectAppError(openAttachment(await principal(U.contosoRequester2), a.id), 404);
    await expectAppError(openAttachment(await principal(U.fabrikamAdmin), a.id), 404);
    await expectAppError(openAttachment(await principal(U.techFabrikam), a.id), 404);
    await expectAppError(openAttachment(await principal(U.operator), a.id), 404);
  });

  it("keeps internal files from customers", async () => {
    const t = await newTicket();
    const tech = await principal(U.tech);
    const a = await uploadAttachment(tech, { ticketId: t.id, filename: "notes.txt", data: new TextEncoder().encode("internal log"), visibility: "internal" });
    await processJobs({ limit: 50 });
    expect((await openAttachment(tech, a.id)).info.id).toBe(a.id);
    await expectAppError(openAttachment(await principal(U.contosoRequester), a.id), 404);
    await expectAppError(openAttachment(await principal(U.contosoAdmin), a.id), 404);
    expect((await getTicket(await principal(U.contosoRequester), t.id)).attachments).toHaveLength(0);
    await expectAppError(uploadAttachment(await principal(U.contosoRequester), { ticketId: t.id, filename: "x.txt", data: new TextEncoder().encode("x"), visibility: "internal" }), 403);
  });

  it("rejects mismatched, active and oversized files", async () => {
    const t = await newTicket();
    const p = await principal(U.contosoRequester);
    const up = (filename: string, data: Uint8Array) => uploadAttachment(p, { ticketId: t.id, filename, data, visibility: "public" });
    await expectAppError(up("photo.png", new TextEncoder().encode("MZ fake exe")), 422);
    await expectAppError(up("page.html", new TextEncoder().encode("<html></html>")), 422);
    await expectAppError(up("logo.svg", new TextEncoder().encode("<svg/>")), 422);
    await expectAppError(up("trick.txt", new TextEncoder().encode("<script>alert(1)</script>")), 422);
    await expectAppError(up("setup.exe", new Uint8Array([0x4d, 0x5a, 1, 2])), 422);
    const macro = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode("[Content_Types].xml word/document.xml word/vbaProject.bin")]);
    await expectAppError(up("report.docx", macro), 422);
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    big.set(PNG);
    await expectAppError(up("big.png", big), 422);
    await expectAppError(up("empty.txt", new Uint8Array()), 422);
  });

  it("cannot attach to someone else's ticket", async () => {
    const t = await newTicket(U.fabrikamRequester);
    await expectAppError(uploadAttachment(await principal(U.contosoRequester), { ticketId: t.id, filename: "a.png", data: PNG, visibility: "public" }), 404);
  });
});

describe("email intake", () => {
  const sign = (body: string, ts = Math.floor(Date.now() / 1000), id = `msg_${randomUUID()}`) => {
    const key = Buffer.from(SECRET.slice(6), "base64");
    const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
    return { id, timestamp: String(ts), signature: `v1,${sig}` };
  };

  it("verifies webhook signatures and timestamps", () => {
    const body = JSON.stringify({ type: "email.received", data: { email_id: "x" } });
    expect(verifySvixSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifySvixSignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(verifySvixSignature(body, sign(body, Math.floor(Date.now() / 1000) - 3600), SECRET)).toBe(false);
    expect(verifySvixSignature(body, { ...sign(body), signature: "v1,AAAA" }, SECRET)).toBe(false);
    expect(verifySvixSignature(body, { id: null, timestamp: null, signature: null }, SECRET)).toBe(false);
  });

  it("extracts only the new part of a reply", () => {
    expect(extractReply("Thanks, that fixed it!\n\nOn Mon, Jan 5, 2026 at 9:00 AM IT Center <x@y> wrote:\n> old text")).toBe("Thanks, that fixed it!");
    expect(extractReply("Still broken.\n##- Reply above this line to add it to your request -##\nRequest #5")).toBe("Still broken.");
    expect(extractReply("Ok\n\nFrom: IT Center\nSent: Monday\nSubject: x")).toBe("Ok");
  });

  async function replyAddressFor(ticketId: string, userId: string) {
    await processJobs({ limit: 50 });
    sent.length = 0;
    await addMessage(await principal(U.tech), ticketId, { body: "Please confirm", visibility: "public" });
    await processJobs({ limit: 50 });
    const email = (await asSystem((tx) => tx.query<{ email: string }>("select email from users where id = $1", [userId]))).rows[0].email;
    const mail = sent.find((s) => (s.body.to as string[])[0] === email && String(s.body.reply_to ?? "").startsWith("t-"));
    expect(mail, `reply mail for ${userId}`).toBeTruthy();
    return String(mail!.body.reply_to);
  }

  async function deliver(email: Record<string, unknown>) {
    const id = randomUUID();
    received.set(id, { id, text: null, html: null, headers: {}, ...email });
    const body = JSON.stringify({ type: "email.received", data: { email_id: id, from: email.from, to: email.to, subject: email.subject ?? "Re" } });
    const r = await recordInboundWebhook(body);
    expect(r.queued).toBe(true);
    expect((await recordInboundWebhook(body)).queued).toBe(false); // replayed delivery ignored
    const row = (await asSystem((tx) => tx.query<{ id: string }>("select id from inbound_emails where provider_email_id = $1", [id]))).rows[0];
    await ingestInboundEmail(row.id);
    return (await asSystem((tx) => tx.query("select * from inbound_emails where id = $1", [row.id]))).rows[0];
  }

  it("adds a reply from the right person to the right ticket", async () => {
    const t = await newTicket();
    const to = await replyAddressFor(t.id, U.contosoRequester);
    const requester = (await asSystem((tx) => tx.query<{ email: string }>("select email from users where id = $1", [U.contosoRequester]))).rows[0].email;
    files.set("/doc.png", PNG);
    const row = await deliver({
      from: `Riley <${requester}>`,
      to: [to],
      text: "Confirmed, all good now.\n\nOn Tue, IT Center wrote:\n> Please confirm",
      authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
      attachments: [{ id: "a1", filename: "doc.png", content_type: "image/png", size: PNG.length, download_url: "https://files.example.test/doc.png" }],
    });
    expect(row.status).toBe("attached");
    const view = await getTicket(await principal(U.contosoRequester), t.id);
    const last = view.messages.at(-1)!;
    expect(last.body).toBe("Confirmed, all good now.");
    expect(last.source).toBe("email");
    expect(view.attachments.map((a) => a.filename)).toContain("doc.png");
  });

  it("never trusts the sender address alone", async () => {
    const t = await newTicket();
    const to = await replyAddressFor(t.id, U.contosoRequester);
    const spoof = await deliver({ from: "attacker@evil.test", to: [to], text: "Close this ticket" });
    expect(spoof.status).toBe("needs_review");
    const requester = (await asSystem((tx) => tx.query<{ email: string }>("select email from users where id = $1", [U.contosoRequester]))).rows[0].email;
    const noToken = await deliver({ from: requester, to: ["help@in.example.test"], text: "New problem" });
    expect(noToken.status).toBe("needs_review");
    const forged = await deliver({ from: requester, to: ["t-notarealtoken123@in.example.test"], text: "hi" });
    expect(forged.status).toBe("needs_review");
    const dmarc = await deliver({ from: requester, to: [to], text: "hi", authentication: { spf: "fail", dkim: "fail", dmarc: "fail" } });
    expect(dmarc.status).toBe("needs_review");
    const auto = await deliver({ from: requester, to: [to], text: "I am out of office", headers: { "auto-submitted": "auto-replied" } });
    expect(auto.status).toBe("discarded");
    expect((await getTicket(await principal(U.tech), t.id)).messages.filter((m) => m.source === "email")).toHaveLength(0);
  });

  it("service managers review and convert new emails; others cannot", async () => {
    const requester = (await asSystem((tx) => tx.query<{ email: string }>("select email from users where id = $1", [U.contosoRequester]))).rows[0].email;
    const row = await deliver({ from: requester, to: ["help@in.example.test"], subject: "VPN down", text: "The VPN will not connect." });
    await expectAppError(listInbox(await principal(U.tech)), 403);
    const mgr = await principal(U.manager);
    const item = (await listInbox(mgr)).find((i) => i.id === row.id)!;
    expect(item.suggestions.map((s) => s.userId)).toContain(U.contosoRequester);
    const convert = { customerId: C, requesterUserId: U.contosoRequester, title: "VPN down", priority: "high", category: "network" };
    await expectAppError(convertInbound(mgr, row.id as string, { ...convert, customerId: F }), 422);
    const r = await convertInbound(mgr, row.id as string, convert);
    const t = await getTicket(await principal(U.contosoRequester), r.ticketId);
    expect(t.description).toBe("The VPN will not connect.");
    await expectAppError(convertInbound(mgr, row.id as string, convert), 404);
    const other = await deliver({ from: "someone@else.test", to: ["help@in.example.test"], text: "spam" });
    await discardInbound(mgr, other.id as string);
    expect((await listInbox(mgr)).some((i) => i.id === other.id)).toBe(false);
  });
});
