import { CALL_OUTCOMES, INDUSTRY_LABEL, PIPELINE_STAGES, REGION_LABEL, UNTOUCHED_STAGES, VETERINARY_INDUSTRY } from "./constants";
import { addDays, dayKey, endOfDay, startOfDay, startOfWeekDay } from "./dates";
import { db } from "./db";
import { isOpen, monthlyValue, num, pipelineTotals, round2, weightedValue } from "./money";

/**
 * Dashboard and analytics numbers. Pipeline figures are estimates from open deals;
 * "contracted" figures come only from Client records and are the only revenue shown.
 */

export interface Range {
  from: Date;
  to: Date;
}

export function todayRange(): Range {
  const d = dayKey();
  return { from: startOfDay(d), to: endOfDay(d) };
}

export function weekRange(): Range {
  const d = dayKey();
  const monday = startOfWeekDay(d);
  return { from: startOfDay(monday), to: endOfDay(addDays(monday, 6)) };
}

export function monthRange(): Range {
  const d = dayKey();
  const first = `${d.slice(0, 8)}01`;
  const [y, m] = d.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from: startOfDay(first), to: startOfDay(next) };
}

const REACHED = new Set(CALL_OUTCOMES.filter((o) => o.reached).map((o) => o.key as string));

export async function leadOverview() {
  const week = weekRange();
  const live = { archived: false };
  const [total, newThisWeek, untouched, byStage, startups, veterinary, overdue] = await Promise.all([
    db.company.count({ where: live }),
    db.company.count({ where: { ...live, createdAt: { gte: week.from } } }),
    db.company.count({ where: { ...live, stage: { in: UNTOUCHED_STAGES as never }, lastContactedAt: null } }),
    db.company.groupBy({ by: ["stage"], where: live, _count: { _all: true } }),
    db.company.count({ where: { ...live, businessStage: "STARTUP" } }),
    db.company.count({ where: { ...live, industry: VETERINARY_INDUSTRY } }),
    db.task.count({ where: { completedAt: null, dueAt: { lt: startOfDay(dayKey()) }, company: { archived: false } } }),
  ]);
  const stageCount = Object.fromEntries(byStage.map((s) => [s.stage, s._count._all])) as Record<string, number>;
  const sum = (keys: string[]) => keys.reduce((n, k) => n + (stageCount[k] ?? 0), 0);
  return {
    total,
    newThisWeek,
    untouched,
    contacted: sum(["CONTACTED", "FOLLOW_UP_REQUIRED"]),
    attempted: sum(["ATTEMPTED_CONTACT"]),
    interested: sum(["INTERESTED"]),
    meetings: sum(["DISCOVERY_SCHEDULED", "DISCOVERY_COMPLETED", "ASSESSMENT"]),
    proposals: sum(["PROPOSAL_DRAFTING", "PROPOSAL_SENT", "NEGOTIATION", "CONTRACT_SENT"]),
    won: sum(["CLOSED_WON"]),
    lost: sum(["CLOSED_LOST", "NOT_INTERESTED"]),
    startups,
    veterinary,
    overdueFollowUps: overdue,
    byStage: PIPELINE_STAGES.map((s) => ({ key: s.key, label: s.label, count: stageCount[s.key] ?? 0 })),
  };
}

export async function revenueOverview(pricePerUser: number) {
  const [deals, clients, month] = await Promise.all([
    db.company.findMany({
      where: { archived: false },
      select: { stage: true, industry: true, region: true, managedUsers: true, pricePerUser: true, monthlyValueOverride: true, implementationFee: true, closeProbability: true },
    }),
    db.client.findMany({ where: { active: true }, select: { monthlyValue: true, implementationFee: true, contractStart: true } }),
    Promise.resolve(monthRange()),
  ]);
  const totals = pipelineTotals(deals, pricePerUser);
  const contractedMrr = round2(clients.reduce((s, c) => s + (num(c.monthlyValue) ?? 0), 0));
  const wonThisMonth = clients.filter((c) => c.contractStart >= month.from && c.contractStart < month.to);
  const group = (key: "industry" | "region", labels: Record<string, string>) => {
    const map = new Map<string, { mrr: number; weighted: number; deals: number }>();
    for (const d of deals) {
      if (!isOpen(d.stage)) continue;
      const k = d[key] ?? "unknown";
      const g = map.get(k) ?? { mrr: 0, weighted: 0, deals: 0 };
      g.mrr += monthlyValue(d, pricePerUser);
      g.weighted += weightedValue(d, pricePerUser);
      g.deals += 1;
      map.set(k, g);
    }
    return [...map.entries()]
      .map(([k, g]) => ({ key: k, label: labels[k] ?? (k === "unknown" ? "Unknown" : k), mrr: round2(g.mrr), weighted: round2(g.weighted), deals: g.deals }))
      .sort((a, b) => b.mrr - a.mrr || b.deals - a.deals);
  };
  return {
    ...totals,
    contractedMrr,
    contractedArr: round2(contractedMrr * 12),
    activeClients: clients.length,
    wonThisMonthMrr: round2(wonThisMonth.reduce((s, c) => s + (num(c.monthlyValue) ?? 0), 0)),
    wonThisMonthImplementation: round2(wonThisMonth.reduce((s, c) => s + (num(c.implementationFee) ?? 0), 0)),
    missingUserCounts: deals.filter((d) => isOpen(d.stage) && !d.managedUsers && num(d.monthlyValueOverride) === null).length,
    byIndustry: group("industry", INDUSTRY_LABEL),
    byRegion: group("region", REGION_LABEL),
  };
}

export async function salesActivity(range: Range, userId?: string) {
  const who = userId ? { userId } : {};
  const [calls, emails, replies, meetingsBooked, emailedCompanies, repliedCompanies, contacted, converted] = await Promise.all([
    db.activity.findMany({ where: { ...who, type: "CALL", occurredAt: { gte: range.from, lt: range.to } }, select: { callOutcome: true, durationSec: true } }),
    db.activity.count({ where: { ...who, type: "EMAIL_SENT", occurredAt: { gte: range.from, lt: range.to } } }),
    db.activity.count({ where: { type: "REPLY_RECEIVED", occurredAt: { gte: range.from, lt: range.to } } }),
    db.activity.count({ where: { ...who, type: "CALL", callOutcome: "MEETING_SCHEDULED", occurredAt: { gte: range.from, lt: range.to } } }),
    db.activity.findMany({ where: { type: "EMAIL_SENT", occurredAt: { gte: range.from, lt: range.to } }, distinct: ["companyId"], select: { companyId: true } }),
    db.activity.findMany({ where: { type: "REPLY_RECEIVED", occurredAt: { gte: range.from, lt: range.to } }, distinct: ["companyId"], select: { companyId: true } }),
    db.company.count({ where: { lastContactedAt: { not: null } } }),
    db.client.count(),
  ]);
  const meetingTasks = await db.task.count({ where: { type: "MEETING", dueAt: { gte: range.from, lt: range.to } } });
  const reached = calls.filter((c) => c.callOutcome && REACHED.has(c.callOutcome)).length;
  const emailedSet = new Set(emailedCompanies.map((e) => e.companyId));
  const repliedFromEmailed = repliedCompanies.filter((r) => emailedSet.has(r.companyId)).length;
  const talkSeconds = calls.reduce((s, c) => s + (c.durationSec ?? 0), 0);
  return {
    calls: calls.length,
    reached,
    contactRate: calls.length ? Math.round((reached / calls.length) * 100) : null,
    talkMinutes: Math.round(talkSeconds / 60),
    emails,
    replies,
    responseRate: emailedSet.size ? Math.round((repliedFromEmailed / emailedSet.size) * 100) : null,
    meetingsBooked,
    meetingsScheduled: meetingTasks,
    conversionRate: contacted ? Math.round((converted / contacted) * 1000) / 10 : null,
    outcomes: CALL_OUTCOMES.map((o) => ({ key: o.key, label: o.label, count: calls.filter((c) => c.callOutcome === o.key).length })),
  };
}

export async function followUpCounts(userId?: string) {
  const today = dayKey();
  const mine = userId ? { OR: [{ assigneeId: userId }, { assigneeId: null }] } : {};
  const [overdue, dueToday] = await Promise.all([
    db.task.count({ where: { ...mine, completedAt: null, dueAt: { lt: startOfDay(today) }, company: { archived: false } } }),
    db.task.count({ where: { ...mine, completedAt: null, dueAt: { gte: startOfDay(today), lt: endOfDay(today) }, company: { archived: false } } }),
  ]);
  return { overdue, dueToday };
}

/** Daily counts of calls and emails for charts, keyed by business-time-zone day. */
export async function dailySeries(range: Range) {
  const rows = await db.activity.findMany({
    where: { type: { in: ["CALL", "EMAIL_SENT", "REPLY_RECEIVED"] }, occurredAt: { gte: range.from, lt: range.to } },
    select: { type: true, occurredAt: true, callOutcome: true },
  });
  const days: string[] = [];
  for (let d = dayKey(range.from); startOfDay(d) < range.to && days.length < 400; d = addDays(d, 1)) days.push(d);
  const map = new Map(days.map((d) => [d, { day: d, calls: 0, reached: 0, emails: 0, replies: 0 }]));
  for (const r of rows) {
    const e = map.get(dayKey(r.occurredAt));
    if (!e) continue;
    if (r.type === "CALL") {
      e.calls++;
      if (r.callOutcome && REACHED.has(r.callOutcome)) e.reached++;
    } else if (r.type === "EMAIL_SENT") e.emails++;
    else e.replies++;
  }
  return [...map.values()];
}

/** Leads added per source/industry and how far they got. */
export async function industryPerformance() {
  const rows = await db.company.groupBy({ by: ["industry", "stage"], where: { archived: false }, _count: { _all: true } });
  const map = new Map<string, { industry: string; total: number; contacted: number; interested: number; won: number }>();
  const contactedStages = new Set(PIPELINE_STAGES.map((s) => s.key).filter((k) => !UNTOUCHED_STAGES.includes(k)));
  const interestedStages = new Set(PIPELINE_STAGES.slice(6, 15).map((s) => s.key));
  for (const r of rows) {
    const g = map.get(r.industry) ?? { industry: INDUSTRY_LABEL[r.industry] ?? r.industry, total: 0, contacted: 0, interested: 0, won: 0 };
    g.total += r._count._all;
    if (contactedStages.has(r.stage)) g.contacted += r._count._all;
    if (interestedStages.has(r.stage)) g.interested += r._count._all;
    if (r.stage === "CLOSED_WON") g.won += r._count._all;
    map.set(r.industry, g);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}
