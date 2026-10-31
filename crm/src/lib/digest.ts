import { addDays, dayKey, endOfDay, startOfDay, weekday } from "./dates";
import { db } from "./db";
import { deliver, mailProvider } from "./mail";
import { getSetting, setSetting } from "./settings";

/**
 * The weekday morning email: follow-ups due, emails waiting for approval,
 * what came in since the last one, and renewals coming up. Nothing is sent to
 * someone with nothing to do. Also creates a task for each upcoming renewal.
 */

const RENEWAL_NOTICE_DAYS = 60;
const RENEWAL_TASK_LEAD_DAYS = 30;
const LIST_LIMIT = 5;

export interface DigestData {
  overdue: { count: number; items: string[] };
  dueToday: { count: number; items: string[] };
  awaitingApproval: number;
  replies: string[];
  inquiries: string[];
  optOuts: string[];
  bounces: string[];
  renewals: string[];
  inboxError: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The email, or null when there's nothing to say. */
export function renderDigest(d: DigestData, origin: string): { subject: string; text: string } | null {
  const headline: string[] = [];
  if (d.replies.length) headline.push(plural(d.replies.length, "reply", "replies"));
  if (d.inquiries.length) headline.push(plural(d.inquiries.length, "website inquiry", "website inquiries"));
  if (d.overdue.count) headline.push(`${plural(d.overdue.count, "follow-up")} overdue`);
  if (d.dueToday.count) headline.push(`${d.dueToday.count} due today`);
  if (d.awaitingApproval) headline.push(`${plural(d.awaitingApproval, "email")} to approve`);
  if (d.renewals.length) headline.push(plural(d.renewals.length, "renewal"));
  if (d.bounces.length) headline.push(plural(d.bounces.length, "bounce"));
  if (d.optOuts.length) headline.push(plural(d.optOuts.length, "opt-out"));
  if (!headline.length && !d.inboxError) return null;

  const section = (title: string, items: string[], more = 0) =>
    items.length ? [title, ...items.map((i) => `- ${i}`), ...(more > 0 ? [`- and ${more} more`] : []), ""] : [];
  const lines = [
    ...section("Replies", d.replies),
    ...section("Website inquiries", d.inquiries),
    ...section(`Overdue follow-ups (${d.overdue.count})`, d.overdue.items, d.overdue.count - d.overdue.items.length),
    ...section(`Due today (${d.dueToday.count})`, d.dueToday.items, d.dueToday.count - d.dueToday.items.length),
    ...(d.awaitingApproval ? [`${plural(d.awaitingApproval, "email")} waiting for your approval: ${origin}/outreach`, ""] : []),
    ...section("Renewals coming up", d.renewals),
    ...section("Bounced (marked invalid)", d.bounces),
    ...section("Opted out", d.optOuts),
    ...(d.inboxError ? [`The CRM couldn't read the mailbox, so replies may be missing: ${d.inboxError}`, ""] : []),
    `Open the CRM: ${origin}/`,
    `Turn this email off under Account: ${origin}/account`,
  ];
  return { subject: headline.length ? `CRM today: ${headline.slice(0, 3).join(", ")}` : "CRM today: the mailbox needs attention", text: lines.join("\n") };
}

const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

async function dataFor(user: { id: string; role: string }, since: Date, now: Date, inboxError: string | null): Promise<DigestData> {
  const today = dayKey(now);
  const mine = { completedAt: null, company: { archived: false }, OR: [{ assigneeId: user.id }, { assigneeId: null }] };
  const taskLine = (t: { title: string; company: { name: string } }) => clean(`${t.company.name}: ${t.title}`);
  const select = { title: true, company: { select: { name: true } } };
  const [overdueCount, overdue, dueCount, due, awaitingApproval, activity, renewals] = await Promise.all([
    db.task.count({ where: { ...mine, dueAt: { lt: startOfDay(today) } } }),
    db.task.findMany({ where: { ...mine, dueAt: { lt: startOfDay(today) } }, orderBy: { dueAt: "asc" }, take: LIST_LIMIT, select }),
    db.task.count({ where: { ...mine, dueAt: { gte: startOfDay(today), lte: endOfDay(today) } } }),
    db.task.findMany({ where: { ...mine, dueAt: { gte: startOfDay(today), lte: endOfDay(today) } }, orderBy: { dueAt: "asc" }, take: LIST_LIMIT, select }),
    db.emailMessage.count({ where: { status: "PENDING_APPROVAL" } }),
    db.activity.findMany({
      where: { type: { in: ["REPLY_RECEIVED", "WEBSITE_INQUIRY", "UNSUBSCRIBED", "BOUNCED"] }, occurredAt: { gte: since } },
      orderBy: { occurredAt: "desc" },
      take: 60,
      select: { type: true, summary: true, company: { select: { name: true } } },
    }),
    db.client.findMany({
      where: { active: true, renewalDate: { gte: startOfDay(today), lte: endOfDay(addDays(today, RENEWAL_NOTICE_DAYS)) } },
      orderBy: { renewalDate: "asc" },
      take: LIST_LIMIT,
      select: { renewalDate: true, company: { select: { name: true } } },
    }),
  ]);
  const of = (type: string) => activity.filter((a) => a.type === type).slice(0, LIST_LIMIT).map((a) => clean(`${a.company.name}: ${a.summary}`));
  return {
    overdue: { count: overdueCount, items: overdue.map(taskLine) },
    dueToday: { count: dueCount, items: due.map(taskLine) },
    awaitingApproval,
    replies: of("REPLY_RECEIVED"),
    inquiries: of("WEBSITE_INQUIRY"),
    optOuts: of("UNSUBSCRIBED"),
    bounces: of("BOUNCED"),
    renewals: renewals.map((r) => clean(`${r.company.name}: renews ${r.renewalDate!.toISOString().slice(0, 10)}`)),
    inboxError,
  };
}

/** One email per person per weekday, however many times the job runs. */
export async function sendDigests(now = new Date()): Promise<{ sent: number; skipped?: string; failed?: number }> {
  const today = dayKey(now);
  if (weekday(today) === 0 || weekday(today) === 6) return { sent: 0, skipped: "weekend" };
  if (mailProvider() === "manual") return { sent: 0, skipped: "no email connected" };
  const state = await getSetting("digest");
  if (state.lastDay === today) return { sent: 0, skipped: "already sent today" };
  // Claimed first, so an overlapping run or a retry can't send it twice.
  await setSetting("digest", { lastDay: today, lastAt: now.toISOString() });
  const since = state.lastAt ? new Date(state.lastAt) : new Date(now.getTime() - 86400_000);
  const { lastError } = await getSetting("inboxSync");
  const users = await db.user.findMany({ where: { active: true, dailyDigest: true, role: { in: ["OWNER", "ADMIN", "SALES"] } }, select: { id: true, email: true, role: true } });
  const outreach = await getSetting("outreach");
  const origin = (process.env.APP_ORIGIN ?? "").replace(/\/$/, "");
  let sent = 0;
  let failed = 0;
  for (const u of users) {
    const mail = renderDigest(await dataFor(u, since, now, lastError), origin);
    if (!mail) continue;
    try {
      await deliver({ to: u.email, subject: mail.subject, text: mail.text, fromName: `${outreach.companyName} CRM` });
      sent++;
    } catch {
      failed++;
    }
  }
  return { sent, ...(failed ? { failed } : {}) };
}

/** A task for each renewal within 60 days, due 30 days ahead. Moving the renewal date creates a new one. */
export async function ensureRenewalTasks(now = new Date()): Promise<number> {
  const today = dayKey(now);
  const clients = await db.client.findMany({
    where: { active: true, renewalDate: { gte: startOfDay(today), lte: endOfDay(addDays(today, RENEWAL_NOTICE_DAYS)) } },
    select: { id: true, companyId: true, renewalDate: true, renewalTaskFor: true, technicianId: true, company: { select: { ownerId: true } } },
  });
  let created = 0;
  for (const c of clients) {
    const renewal = c.renewalDate!;
    if (c.renewalTaskFor?.getTime() === renewal.getTime()) continue;
    const ahead = new Date(renewal.getTime() - RENEWAL_TASK_LEAD_DAYS * 86400_000);
    await db.$transaction(async (tx) => {
      await tx.task.create({
        data: {
          companyId: c.companyId,
          assigneeId: c.company.ownerId ?? c.technicianId,
          type: "CONTRACT",
          title: `Contract renews ${renewal.toISOString().slice(0, 10)}: talk to the client`,
          dueAt: ahead > now ? ahead : endOfDay(today),
        },
      });
      await tx.client.update({ where: { id: c.id }, data: { renewalTaskFor: renewal } });
    });
    created++;
  }
  return created;
}
