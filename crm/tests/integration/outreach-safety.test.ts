import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/unsubscribe/[token]/route";
import { db } from "@/lib/db";
import { fullBody } from "@/lib/mail";
import { isSuppressed, lookupUnsubscribe, readUnsubscribeToken, unsubscribeByToken, unsubscribeToken, unsubscribeUrl } from "@/lib/optout";
import { approveAndSend } from "@/lib/outreach";
import { setSetting } from "@/lib/settings";
import { makeProspect, makeUser, resetDatabase, sentEmail } from "./helpers";

const sendMail = vi.hoisted(() => vi.fn(async (_m: Record<string, unknown>) => ({ messageId: "<sent-1@example.test>" })));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));

const req = (token: string, form?: Record<string, string>) =>
  new Request(`https://crm.example.test/api/unsubscribe/${token}`, {
    method: "POST",
    ...(form ? { body: new URLSearchParams(form), headers: { "content-type": "application/x-www-form-urlencoded" } } : {}),
  });
const ctx = (token: string) => ({ params: Promise.resolve({ token }) });

beforeEach(async () => {
  await resetDatabase();
  sendMail.mockClear();
  process.env.GMAIL_USER = "sales@example.test";
  process.env.GMAIL_APP_PASSWORD = "not-a-real-password";
  await setSetting("outreach", { mailingAddress: "PO Box 1, Hercules, CA" });
});

describe("unsubscribe tokens", () => {
  it("only the real signature for that email works", () => {
    const t = unsubscribeToken("email-1");
    expect(readUnsubscribeToken(t)).toBe("email-1");
    expect(readUnsubscribeToken(`email-2.${t.split(".")[1]}`)).toBeNull();
    expect(readUnsubscribeToken("email-1.wrong")).toBeNull();
    expect(readUnsubscribeToken("nonsense")).toBeNull();
    expect(readUnsubscribeToken("")).toBeNull();
  });
});

describe("what goes out", () => {
  it("every email has a working unsubscribe link and the mail-app headers", async () => {
    const user = await makeUser();
    const c = await makeProspect({ email: "dana@acme.example" });
    const e = await db.emailMessage.create({ data: { companyId: c.id, toEmail: "dana@acme.example", subject: "Hi", body: "Hello there", status: "PENDING_APPROVAL" } });
    expect(await approveAndSend(e.id, user.id)).toEqual({ ok: true, via: "gmail" });
    const sent = sendMail.mock.calls[0][0] as { text: string; headers: Record<string, string> };
    const url = unsubscribeUrl(e.id);
    expect(sent.text).toContain(`Unsubscribe: ${url}`);
    expect(sent.text).toContain("PO Box 1, Hercules, CA");
    expect(sent.headers["List-Unsubscribe"]).toBe(`<https://crm.example.test/api/unsubscribe/${unsubscribeToken(e.id)}>`);
    expect(sent.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    // Replies thread against this id.
    expect((await db.emailMessage.findUniqueOrThrow({ where: { id: e.id } })).providerMessageId).toBe("<sent-1@example.test>");
  });

  it("the footer can't be sent to a mail app without the link either", () => {
    const body = fullBody("Hi", { senderName: "B", signature: "S", mailingAddress: "A", optOutLine: "O" } as never, "e1");
    expect(body).toContain(unsubscribeUrl("e1"));
  });
});

describe("opting out", () => {
  async function scene() {
    const c = await makeProspect({ email: "dana@acme.example" });
    const s = await sentEmail(c.id, "dana@acme.example", { contactId: c.contacts[0].id, withSequence: true });
    return { c, ...s, token: unsubscribeToken(s.email.id) };
  }

  it("a mail app's one-click POST stops everything queued, once", async () => {
    const { c, token, draft, enrollmentId } = await scene();
    const res = await POST(req(token, { "List-Unsubscribe": "One-Click" }), ctx(token));
    expect(res.status).toBe(200);
    expect(await isSuppressed("DANA@acme.example")).toBe(true);
    expect((await db.contact.findFirstOrThrow({ where: { companyId: c.id } })).doNotContact).toBe(true);
    expect(await db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId! } })).toMatchObject({ status: "STOPPED", nextStepDueAt: null });
    expect((await db.emailMessage.findUniqueOrThrow({ where: { id: draft!.id } })).status).toBe("CANCELLED");
    await POST(req(token), ctx(token));
    expect(await db.activity.count({ where: { companyId: c.id, type: "UNSUBSCRIBED" } })).toBe(1);
  });

  it("opening the link does nothing: mail scanners open links", async () => {
    const { token } = await scene();
    const res = await GET(new Request(`https://crm.example.test/api/unsubscribe/${token}`), ctx(token));
    expect(res.status).toBe(303);
    expect(await isSuppressed("dana@acme.example")).toBe(false);
    const view = await lookupUnsubscribe(token);
    expect(view).toMatchObject({ done: false });
    expect(view!.email).not.toContain("dana");
    expect(view!.email).toContain("@acme.example");
  });

  it("the page's button returns to the page; a forged token changes nothing", async () => {
    const { token } = await scene();
    const res = await POST(req(token, { from: "page" }), ctx(token));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain(`/unsubscribe/${token}`);
    expect((await lookupUnsubscribe(token))?.done).toBe(true);
    await db.emailSuppression.deleteMany();
    expect((await POST(req("x.y"), ctx("x.y"))).status).toBe(404);
    expect(await unsubscribeByToken("nope")).toBe(false);
    expect(await db.emailSuppression.count()).toBe(0);
  });

  it("the company inbox opting out marks the company", async () => {
    const c = await makeProspect({ mainEmail: "info@acme.example" });
    const { email } = await sentEmail(c.id, "info@acme.example");
    await unsubscribeByToken(unsubscribeToken(email.id));
    expect((await db.company.findUniqueOrThrow({ where: { id: c.id } })).doNotContact).toBe(true);
  });

  it("no route around it: a new draft, a new contact or a re-imported prospect is still blocked", async () => {
    const user = await makeUser();
    const { token } = await scene();
    await unsubscribeByToken(token);
    // The same person comes back as a brand-new record, as a re-import would create.
    const again = await makeProspect({ name: "Acme Dental LLC", email: "Dana@Acme.example" });
    const e = await db.emailMessage.create({ data: { companyId: again.id, toEmail: "Dana@Acme.example", subject: "Hi", body: "Hello", status: "PENDING_APPROVAL" } });
    const out = await approveAndSend(e.id, user.id);
    expect(out).toMatchObject({ ok: false });
    expect((out as { error: string }).error).toContain("opted out");
    expect(sendMail).not.toHaveBeenCalled();
  });
});
