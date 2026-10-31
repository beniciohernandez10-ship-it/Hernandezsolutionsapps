import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, dayKey, endOfDay } from "@/lib/dates";
import { db } from "@/lib/db";
import { ensureRenewalTasks, renderDigest, sendDigests, type DigestData } from "@/lib/digest";
import { getSetting } from "@/lib/settings";
import { makeProspect, makeUser, resetDatabase } from "./helpers";

const sendMail = vi.hoisted(() => vi.fn(async (_m: Record<string, unknown>) => ({ messageId: "<d@example.test>" })));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));

// A Wednesday and a Saturday, midday Pacific.
const WEEKDAY = new Date("2026-10-28T19:00:00Z");
const SATURDAY = new Date("2026-10-31T19:00:00Z");

const empty: DigestData = { overdue: { count: 0, items: [] }, dueToday: { count: 0, items: [] }, awaitingApproval: 0, replies: [], inquiries: [], optOuts: [], bounces: [], renewals: [], inboxError: null };
const mailsTo = (email: string) => sendMail.mock.calls.map((c) => c[0] as { to: string; subject: string; text: string }).filter((m) => m.to === email);

beforeEach(async () => {
  await resetDatabase();
  sendMail.mockClear();
  process.env.GMAIL_USER = "sales@example.test";
  process.env.GMAIL_APP_PASSWORD = "not-a-real-password";
});

describe("the email", () => {
  it("says nothing on a day with nothing to do", () => {
    expect(renderDigest(empty, "https://crm")).toBeNull();
  });

  it("leads with what matters and links back", () => {
    const m = renderDigest(
      { ...empty, replies: ["Acme: Reply from dana"], overdue: { count: 7, items: ["Acme: Call back"] }, dueToday: { count: 1, items: ["Bolt: Send proposal"] }, awaitingApproval: 2 },
      "https://crm",
    )!;
    expect(m.subject).toBe("CRM today: 1 reply, 7 follow-ups overdue, 1 due today");
    expect(m.text).toContain("Replies\n- Acme: Reply from dana");
    expect(m.text).toContain("Overdue follow-ups (7)\n- Acme: Call back\n- and 6 more");
    expect(m.text).toContain("2 emails waiting for your approval: https://crm/outreach");
    expect(m.text).toContain("https://crm/account");
  });

  it("warns when the mailbox can't be read, even if nothing else is new", () => {
    const m = renderDigest({ ...empty, inboxError: "Invalid credentials" }, "https://crm")!;
    expect(m.subject).toContain("mailbox");
    expect(m.text).toContain("Invalid credentials");
  });
});

describe("sending", () => {
  async function work(userId: string | null, title = "Call back") {
    const c = await makeProspect({ name: `Co ${title}` });
    await db.task.create({ data: { companyId: c.id, assigneeId: userId, type: "CALLBACK", title, dueAt: new Date(WEEKDAY.getTime() - 3 * 86400_000) } });
    return c;
  }

  it("sends each person their own work, once per weekday", async () => {
    const a = await makeUser({ email: "a@example.test" });
    const b = await makeUser({ email: "b@example.test", role: "SALES" });
    await work(a.id, "For A");
    await work(b.id, "For B");
    await work(null, "For anyone");
    expect(await sendDigests(WEEKDAY)).toEqual({ sent: 2 });
    const toA = mailsTo("a@example.test")[0];
    expect(toA.text).toContain("For A");
    expect(toA.text).toContain("For anyone");
    expect(toA.text).not.toContain("For B");
    expect(await sendDigests(WEEKDAY)).toMatchObject({ sent: 0, skipped: "already sent today" });
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("skips weekends, viewers, people who turned it off, and anyone with nothing to do", async () => {
    await makeUser({ email: "off@example.test", dailyDigest: false });
    await makeUser({ email: "viewer@example.test", role: "VIEWER" });
    await makeUser({ email: "idle@example.test", role: "SALES" });
    expect(await sendDigests(SATURDAY)).toMatchObject({ skipped: "weekend" });
    const c = await makeProspect();
    const off = await db.user.findUniqueOrThrow({ where: { email: "off@example.test" } });
    await db.task.create({ data: { companyId: c.id, assigneeId: off.id, type: "CALLBACK", title: "Mine", dueAt: WEEKDAY } });
    expect((await sendDigests(WEEKDAY)).sent).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("covers what came in since the last one, over a weekend too", async () => {
    await makeUser({ email: "a@example.test" });
    const c = await makeProspect();
    await db.activity.create({ data: { companyId: c.id, type: "REPLY_RECEIVED", summary: "Reply from dana", occurredAt: new Date("2026-10-27T12:00:00Z") } });
    await sendDigests(new Date("2026-10-27T19:00:00Z"));
    sendMail.mockClear();
    await db.activity.create({ data: { companyId: c.id, type: "WEBSITE_INQUIRY", summary: "Contact form from Lee", occurredAt: new Date("2026-10-28T02:00:00Z") } });
    await sendDigests(WEEKDAY);
    const m = mailsTo("a@example.test")[0];
    expect(m.text).toContain("Contact form from Lee");
    expect(m.text).not.toContain("Reply from dana");
    expect((await getSetting("digest")).lastDay).toBe(dayKey(WEEKDAY));
  });

  it("one person's failed send doesn't stop the others or send anyone a second copy", async () => {
    const a = await makeUser({ email: "a@example.test" });
    const b = await makeUser({ email: "b@example.test", role: "SALES" });
    await work(a.id, "For A");
    await work(b.id, "For B");
    sendMail.mockRejectedValueOnce(new Error("SMTP down"));
    expect(await sendDigests(WEEKDAY)).toEqual({ sent: 1, failed: 1 });
    expect(await sendDigests(WEEKDAY)).toMatchObject({ sent: 0 });
  });

  it("does nothing with no email connected", async () => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    expect(await sendDigests(WEEKDAY)).toMatchObject({ skipped: "no email connected" });
  });
});

describe("renewals", () => {
  const onDay = (offset: number) => new Date(`${addDays(dayKey(WEEKDAY), offset)}T12:00:00Z`);

  async function client(renewalOffset: number | null, active = true) {
    const owner = await makeUser({ email: `o${Math.random()}@example.test` });
    const c = await makeProspect({ name: `Client ${renewalOffset}`, ownerId: owner.id, stage: "CLOSED_WON" });
    await db.client.create({
      data: { companyId: c.id, contractStart: new Date("2026-01-01"), managedUsers: 10, monthlyValue: 650, onboarding: [], active, renewalDate: renewalOffset === null ? null : onDay(renewalOffset) },
    });
    return { c, owner };
  }

  it("get one task within 60 days, due 30 days ahead, assigned to the owner", async () => {
    const { c, owner } = await client(45);
    expect(await ensureRenewalTasks(WEEKDAY)).toBe(1);
    expect(await ensureRenewalTasks(WEEKDAY)).toBe(0);
    const t = await db.task.findFirstOrThrow({ where: { companyId: c.id } });
    expect(t).toMatchObject({ type: "CONTRACT", assigneeId: owner.id });
    expect(t.title).toContain("Contract renews");
    expect(t.dueAt.toISOString().slice(0, 10)).toBe(addDays(dayKey(WEEKDAY), 15));
  });

  it("are due now if already closer than 30 days, and moving the date makes a new one", async () => {
    const { c } = await client(10);
    await ensureRenewalTasks(WEEKDAY);
    expect((await db.task.findFirstOrThrow({ where: { companyId: c.id } })).dueAt.getTime()).toBe(endOfDay(dayKey(WEEKDAY)).getTime());
    await db.client.updateMany({ where: { companyId: c.id }, data: { renewalDate: onDay(20) } });
    expect(await ensureRenewalTasks(WEEKDAY)).toBe(1);
    expect(await db.task.count({ where: { companyId: c.id } })).toBe(2);
  });

  it("leave far-off, past, undated and inactive clients alone", async () => {
    await client(90);
    await client(-5);
    await client(null);
    await client(10, false);
    expect(await ensureRenewalTasks(WEEKDAY)).toBe(0);
  });
});
