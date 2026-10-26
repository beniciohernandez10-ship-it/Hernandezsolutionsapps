import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshDatabase, principal } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem } from "@/lib/db";
import { setConfigForTesting } from "@/lib/config";
import { setResendFetchForTesting } from "@/lib/email/resend";
import { processJobs } from "@/lib/jobs";
import { createTicket, updateTicket } from "@/lib/tickets/service";
import { getPreferences, listNotifications } from "@/lib/notify/service";
import { categoryForKind, lookupUnsubscribe } from "@/lib/notify/unsubscribe";
import { GET, POST } from "@/app/api/unsubscribe/[token]/route";

const U = DEMO.users;
const ORIGIN = "http://localhost:3000";

const sent: Record<string, unknown>[] = [];
const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (new URL(String(input)).pathname === "/emails") {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ id: randomUUID() });
  }
  return new Response("unexpected", { status: 500 });
}) as typeof fetch;

const newTicket = async () =>
  createTicket(await principal(U.contosoRequester), { title: "Laptop won't start", description: "Black screen", priority: "normal", category: "hardware" }, randomUUID());

/** The newest email to someone, with the token from its List-Unsubscribe header. */
function lastMailTo(email: string) {
  const mail = sent.filter((m) => (m.to as string[])[0] === email).at(-1);
  if (!mail) throw new Error(`no email to ${email}`);
  const header = (mail.headers as Record<string, string>)["List-Unsubscribe"];
  const token = /\/api\/unsubscribe\/([A-Za-z0-9_-]+)>$/.exec(header)![1];
  return { mail, header, token };
}

const post = (token: string, body: string) =>
  POST(
    new NextRequest(`${ORIGIN}/api/unsubscribe/${token}`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } }),
    { params: Promise.resolve({ token }) },
  );

let techEmail: string;

beforeAll(async () => {
  await freshDatabase();
  setResendFetchForTesting(fakeFetch);
  // Demo users are never emailed; make these two real-looking recipients.
  await asSystem((tx) => tx.query("update users set is_demo = false where id = any($1::uuid[])", [[U.tech, U.contosoRequester]]));
  techEmail = (await principal(U.tech)).email;
});

beforeEach(async () => {
  sent.length = 0;
  await asSystem((tx) => tx.query("delete from notification_preferences"));
  setConfigForTesting({ appOrigin: ORIGIN, demoMode: true, email: { resendApiKey: "re_test", from: "IT Center <support@example.test>" } });
});

describe("one-click unsubscribe", () => {
  it("every notification email carries RFC 8058 headers and a visible link for its own setting", async () => {
    await newTicket();
    await processJobs({ limit: 50 });
    const { mail, header, token } = lastMailTo(techEmail);
    expect(header).toBe(`<${ORIGIN}/api/unsubscribe/${token}>`);
    expect((mail.headers as Record<string, string>)["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(String(mail.html)).toContain(`${ORIGIN}/unsubscribe/${token}`);
    expect(String(mail.text)).toContain(`${ORIGIN}/unsubscribe/${token}`);
    // A new request falls under "New requests" for the technician.
    expect(await lookupUnsubscribe(token)).toMatchObject({ category: "email_new_tickets", label: "New requests", categoryOn: true, allOn: true });
    expect((await lookupUnsubscribe(token))!.email).not.toContain(techEmail.split("@")[0]);
  });

  it("a mail app's one-click POST turns off only that kind of email", async () => {
    await newTicket();
    await processJobs({ limit: 50 });
    const { token } = lastMailTo(techEmail);
    const res = await post(token, "List-Unsubscribe=One-Click");
    expect(res.status).toBe(200);
    const prefs = await getPreferences(await principal(U.tech));
    expect(prefs).toMatchObject({ emailEnabled: true, emailNewTickets: false, emailTicketUpdates: true, emailAssignments: true });

    // The next new request: still shown in the portal, no longer emailed.
    sent.length = 0;
    const t = await newTicket();
    await processJobs({ limit: 50 });
    expect(sent.some((m) => (m.to as string[])[0] === techEmail)).toBe(false);
    expect((await listNotifications(await principal(U.tech))).some((n) => n.ticketId === t.id)).toBe(true);
    // Assignment mail is a different setting and still arrives.
    await updateTicket(await principal(U.manager), t.id, { expectedVersion: 1, assigneeUserId: U.tech });
    await processJobs({ limit: 50 });
    expect(lastMailTo(techEmail).mail.subject).toContain("Assigned to you");

    const audit = await asSystem((tx) => tx.query<{ details: { setting: string } }>("select details from audit_events where action = 'notifications.unsubscribe' and actor_user_id = $1", [U.tech]));
    expect(audit.rows.map((r) => r.details.setting)).toContain("email_new_tickets");
  });

  it("the confirmation page can stop all email and undo it; opening the link changes nothing", async () => {
    const t = await newTicket();
    await updateTicket(await principal(U.tech), t.id, { expectedVersion: 1, status: "in_progress" });
    await processJobs({ limit: 50 });
    const { token } = lastMailTo((await principal(U.contosoRequester)).email);
    const requester = await principal(U.contosoRequester);

    const opened = await GET(new NextRequest(`${ORIGIN}/api/unsubscribe/${token}`), { params: Promise.resolve({ token }) });
    expect(opened.status).toBe(303);
    expect(opened.headers.get("location")).toBe(`${ORIGIN}/unsubscribe/${token}`);
    expect((await getPreferences(requester)).emailEnabled).toBe(true);

    const all = await post(token, "action=all");
    expect(all.status).toBe(303);
    expect(all.headers.get("location")).toBe(`${ORIGIN}/unsubscribe/${token}?done=all`);
    expect((await getPreferences(requester)).emailEnabled).toBe(false);
    expect((await lookupUnsubscribe(token))!.allOn).toBe(false);

    await post(token, "action=undo-all");
    expect((await getPreferences(requester)).emailEnabled).toBe(true);
    await post(token, "action=category");
    expect((await getPreferences(requester)).emailTicketUpdates).toBe(false);
    await post(token, "action=undo-category");
    expect((await getPreferences(requester)).emailTicketUpdates).toBe(true);
  });

  it("rejects unknown, expired and malformed tokens and unexpected bodies", async () => {
    await newTicket();
    await processJobs({ limit: 50 });
    const { token } = lastMailTo(techEmail);
    expect((await post("A".repeat(43), "List-Unsubscribe=One-Click")).status).toBe(404);
    expect((await post("short", "List-Unsubscribe=One-Click")).status).toBe(404);
    expect((await post(token, "hello=world")).status).toBe(400);
    const odd = await post(token, "action=drop-tables");
    expect(odd.headers.get("location")).toBe(`${ORIGIN}/unsubscribe/${token}`);

    await asSystem((tx) => tx.query("update email_unsubscribe_tokens set expires_at = now() - interval '1 minute'"));
    expect(await lookupUnsubscribe(token)).toBeNull();
    expect((await post(token, "List-Unsubscribe=One-Click")).status).toBe(404);
  });

  it("emails queued before categories were recorded fall back to the kind's setting", () => {
    expect(categoryForKind("ticket_created")).toBe("email_new_tickets");
    expect(categoryForKind("assigned")).toBe("email_assignments");
    expect(categoryForKind("sla_breached")).toBe("email_sla");
    expect(categoryForKind("public_reply")).toBe("email_ticket_updates");
    expect(categoryForKind("change_scheduled")).toBe("email_ticket_updates");
  });
});
