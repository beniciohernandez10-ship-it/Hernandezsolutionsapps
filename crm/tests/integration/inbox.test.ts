import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { InboundMail } from "@/lib/inbox/classify";
import { parseRaw } from "@/lib/inbox/fetch";
import { applyInbound, syncInbox } from "@/lib/inbox/sync";
import { isSuppressed } from "@/lib/optout";
import { getSetting } from "@/lib/settings";
import { makeProspect, makeUser, resetDatabase, sentEmail } from "./helpers";

const mail = (over: Partial<InboundMail> = {}): InboundMail => ({
  messageId: `<${randomUUID()}@mail.example>`,
  from: "dana@acme.example",
  subject: "Re: Quick question",
  text: "Yes, let's talk on Tuesday.\n\nOn Mon, Benny wrote:\n> Quick question",
  inReplyTo: null,
  references: [],
  headers: {},
  receivedAt: new Date(),
  ...over,
});

async function scene() {
  const owner = await makeUser();
  const c = await makeProspect({ email: "dana@acme.example", ownerId: owner.id });
  const s = await sentEmail(c.id, "dana@acme.example", { contactId: c.contacts[0].id, messageId: "<sent-1@example.test>", withSequence: true });
  return { owner, c, ...s };
}

beforeEach(async () => {
  await resetDatabase();
  process.env.GMAIL_USER = "sales@example.test";
  process.env.GMAIL_APP_PASSWORD = "not-a-real-password";
});

describe("replies", () => {
  it("stop the sequence, cancel the draft, move the stage and leave a task and the text on the prospect", async () => {
    const { c, draft, enrollmentId, owner } = await scene();
    expect(await applyInbound(mail({ inReplyTo: "<sent-1@example.test>" }))).toBe("reply");
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId! } })).status).toBe("REPLIED");
    expect((await db.emailMessage.findUniqueOrThrow({ where: { id: draft!.id } })).status).toBe("CANCELLED");
    expect((await db.company.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("CONTACTED");
    const a = await db.activity.findFirstOrThrow({ where: { companyId: c.id, type: "REPLY_RECEIVED" } });
    expect(a.body).toBe("Yes, let's talk on Tuesday.");
    expect(await db.task.findFirstOrThrow({ where: { companyId: c.id } })).toMatchObject({ assigneeId: owner.id, title: "Respond to reply from dana@acme.example" });
    expect(await isSuppressed("dana@acme.example")).toBe(false);
  });

  it("are handled once, however many times the mailbox is read", async () => {
    const { c } = await scene();
    const m = mail();
    expect(await applyInbound(m)).toBe("reply");
    expect(await applyInbound(m)).toBe("seen");
    expect(await db.activity.count({ where: { companyId: c.id, type: "REPLY_RECEIVED" } })).toBe(1);
    expect(await db.task.count({ where: { companyId: c.id } })).toBe(1);
  });

  it("match by thread even from a colleague, by address without a thread, or from a known contact", async () => {
    const { c } = await scene();
    expect(await applyInbound(mail({ from: "colleague@acme.example", inReplyTo: "<sent-1@example.test>" }))).toBe("reply");
    expect(await applyInbound(mail())).toBe("reply");
    const known = await makeProspect({ name: "Known Co", email: "pat@known.example" });
    expect(await applyInbound(mail({ from: "pat@known.example" }))).toBe("reply");
    expect(await db.activity.count({ where: { companyId: known.id, type: "REPLY_RECEIVED" } })).toBe(1);
    expect(await db.activity.count({ where: { companyId: c.id, type: "REPLY_RECEIVED" } })).toBe(2);
  });

  it("anything unrelated to a prospect is ignored and nothing about it is kept", async () => {
    await scene();
    const before = await db.activity.count();
    expect(await applyInbound(mail({ from: "newsletter@somewhere.example", subject: "Big sale" }))).toBe("ignored");
    expect(await applyInbound(mail({ from: "sales@example.test" }))).toBe("ignored");
    expect(await db.inboxMessage.count()).toBe(0);
    expect(await db.activity.count()).toBe(before);
  });

  it("an out-of-office is noted but doesn't stop the sequence or look like an answer", async () => {
    const { c, enrollmentId } = await scene();
    expect(await applyInbound(mail({ subject: "Automatic reply: Quick question", text: "I'm out until Monday.", headers: { "auto-submitted": "auto-replied" } }))).toBe("auto_reply");
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId! } })).status).toBe("ACTIVE");
    expect(await db.activity.count({ where: { companyId: c.id, type: "REPLY_RECEIVED" } })).toBe(0);
    expect(await db.task.count({ where: { companyId: c.id } })).toBe(0);
  });
});

describe("opting out by reply", () => {
  it('"no thanks" (what the email footer tells people to say) is honored everywhere', async () => {
    const { c, enrollmentId, draft } = await scene();
    expect(await applyInbound(mail({ text: "No thanks\n\nOn Mon, Benny wrote:\n> hello" }))).toBe("opt_out");
    expect(await isSuppressed("dana@acme.example")).toBe(true);
    expect((await db.contact.findFirstOrThrow({ where: { companyId: c.id } })).doNotContact).toBe(true);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId! } })).status).toBe("REPLIED");
    expect((await db.emailMessage.findUniqueOrThrow({ where: { id: draft!.id } })).status).toBe("CANCELLED");
    expect(await db.activity.count({ where: { companyId: c.id, type: "UNSUBSCRIBED" } })).toBe(1);
    expect(await db.task.count({ where: { companyId: c.id } })).toBe(0);
  });

  it("a colleague asking on someone's behalf opts out the address being emailed too", async () => {
    await scene();
    await applyInbound(mail({ from: "assistant@acme.example", inReplyTo: "<sent-1@example.test>", text: "Please remove me from your list." }));
    expect(await isSuppressed("assistant@acme.example")).toBe(true);
    expect(await isSuppressed("dana@acme.example")).toBe(true);
  });
});

const DSN = (status: string, diagnostic: string, recipient = "dana@acme.example") =>
  [
    "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
    "To: sales@example.test",
    "Subject: Delivery Status Notification (Failure)",
    `Message-ID: <${randomUUID()}@mx.google.com>`,
    "Date: Mon, 26 Oct 2026 10:00:00 -0700",
    "MIME-Version: 1.0",
    `X-Failed-Recipients: ${recipient}`,
    'Content-Type: multipart/report; boundary="b1"; report-type=delivery-status',
    "",
    "--b1",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    "Your message wasn't delivered.",
    "",
    "--b1",
    "Content-Type: message/delivery-status",
    "",
    "Reporting-MTA: dns; mx.google.com",
    "",
    `Final-Recipient: rfc822; ${recipient}`,
    "Action: failed",
    `Status: ${status}`,
    `Diagnostic-Code: smtp; ${diagnostic}`,
    "",
    "--b1--",
    "",
  ].join("\r\n");

describe("bounces, from a real delivery report", () => {
  it("a bad address is marked invalid, suppressed, and stops what's queued", async () => {
    const { c, email, enrollmentId, draft } = await scene();
    await db.company.update({ where: { id: c.id }, data: { mainEmail: "dana@acme.example" } });
    const m = (await parseRaw(DSN("5.1.1", "550 5.1.1 The email account does not exist")))!;
    expect(await applyInbound(m)).toBe("bounce_hard");
    expect((await db.contact.findFirstOrThrow({ where: { companyId: c.id } })).emailStatus).toBe("INVALID");
    expect((await db.company.findUniqueOrThrow({ where: { id: c.id } })).mainEmailStatus).toBe("INVALID");
    expect(await isSuppressed("dana@acme.example")).toBe(true);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId! } })).status).toBe("STOPPED");
    expect((await db.emailMessage.findUniqueOrThrow({ where: { id: draft!.id } })).status).toBe("CANCELLED");
    expect((await db.emailMessage.findUniqueOrThrow({ where: { id: email.id } })).error).toContain("Bounced (5.1.1)");
    expect(await db.task.findFirstOrThrow({ where: { companyId: c.id } })).toMatchObject({ title: "Find a working email: dana@acme.example bounced" });
  });

  it("a spam block or full mailbox isn't treated as a bad address", async () => {
    const { c, enrollmentId } = await scene();
    for (const [status, why] of [["5.7.1", "550 5.7.1 Message rejected as spam"], ["4.2.2", "452 4.2.2 Mailbox full"]]) {
      expect(await applyInbound((await parseRaw(DSN(status, why)))!)).toBe("bounce_soft");
    }
    expect((await db.contact.findFirstOrThrow({ where: { companyId: c.id } })).emailStatus).toBe("UNKNOWN");
    expect(await isSuppressed("dana@acme.example")).toBe(false);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId! } })).status).toBe("ACTIVE");
    expect(await db.activity.count({ where: { companyId: c.id, type: "BOUNCED" } })).toBe(2);
  });

  it("a bounce for an address we never emailed is ignored", async () => {
    await scene();
    expect(await applyInbound((await parseRaw(DSN("5.1.1", "no such user", "someone@else.example")))!)).toBe("ignored");
  });

  it("a later opt-out still applies to an address that bounced", async () => {
    const { c } = await scene();
    await applyInbound((await parseRaw(DSN("5.1.1", "no such user")))!);
    await applyInbound(mail({ text: "Unsubscribe" }));
    expect((await db.emailSuppression.findUniqueOrThrow({ where: { email: "dana@acme.example" } })).reason).toBe("reply");
    expect((await db.contact.findFirstOrThrow({ where: { companyId: c.id } })).doNotContact).toBe(true);
  });
});

describe("what else respects the list", () => {
  it("a backup and restore keeps it, so nobody who left gets email again", async () => {
    await db.emailSuppression.create({ data: { email: "gone@acme.example", reason: "unsubscribe" } });
    const { createBackup, restoreBackup } = await import("@/lib/backup");
    const backup = JSON.parse(JSON.stringify(await createBackup()));
    await db.emailSuppression.deleteMany();
    await restoreBackup(backup);
    expect(await isSuppressed("gone@acme.example")).toBe(true);
  });
});

describe("checking the mailbox", () => {
  const fetcher = (mails: InboundMail[]) => async () => mails;

  it("looks back three days the first time, then from the last success with overlap", async () => {
    const now = new Date("2026-10-26T12:00:00Z");
    const seen: Date[] = [];
    const f = async (since: Date) => {
      seen.push(since);
      return [];
    };
    await syncInbox({ fetcher: f, now, force: true });
    expect(seen[0].toISOString()).toBe("2026-10-23T12:00:00.000Z");
    await syncInbox({ fetcher: f, now: new Date("2026-10-27T12:00:00Z"), force: true });
    expect(seen[1].toISOString()).toBe("2026-10-25T12:00:00.000Z");
  });

  it("runs at most every 15 minutes unless forced", async () => {
    const now = new Date("2026-10-26T12:00:00Z");
    expect((await syncInbox({ fetcher: fetcher([]), now })).read).toBe(0);
    expect((await syncInbox({ fetcher: fetcher([]), now: new Date(now.getTime() + 60_000) })).skipped).toBe("too_soon");
    expect((await syncInbox({ fetcher: fetcher([]), now: new Date(now.getTime() + 60_000), force: true })).read).toBe(0);
    expect((await syncInbox({ fetcher: fetcher([]), now: new Date(now.getTime() + 16 * 60_000) })).read).toBe(0);
  });

  it("reports results, and a failure is recorded without throwing or losing the last good time", async () => {
    await scene();
    const r = await syncInbox({ fetcher: fetcher([mail(), mail({ from: "stranger@x.example" })]), force: true });
    expect(r.handled).toMatchObject({ reply: 1, ignored: 1 });
    const good = (await getSetting("inboxSync")).lastSuccessAt;
    const bad = await syncInbox({ fetcher: async () => { throw new Error("Invalid credentials"); }, force: true });
    expect(bad.error).toBe("Invalid credentials");
    const state = await getSetting("inboxSync");
    expect(state).toMatchObject({ lastError: "Invalid credentials", lastSuccessAt: good });
    await syncInbox({ fetcher: fetcher([]), force: true });
    expect((await getSetting("inboxSync")).lastError).toBeNull();
  });

  it("does nothing with no mailbox connected", async () => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    expect(await syncInbox({ force: true })).toEqual({ skipped: "no_mailbox" });
  });
});
