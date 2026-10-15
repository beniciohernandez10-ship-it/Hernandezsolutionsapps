import { db } from "./db";
import { addDays, endOfDay, startOfDay } from "./dates";
import { getSetting } from "./settings";

export interface QueueCandidate {
  id: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  score: number | null;
  callCount: number;
  lastContactedAt: Date | null;
  nextFollowUpAt: Date | null;
  discoveredAt: Date;
  stage: string;
  callbackDueAt: Date | null;
}

const PRIORITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
const EXCLUDED_STAGES = ["CLOSED_WON", "CLOSED_LOST", "NOT_INTERESTED"];

/** Order candidates for a day: callbacks due, then follow-ups due, then priority, fewest attempts, score, oldest. */
export function rankCandidates(cands: QueueCandidate[], dayEnd: Date): { id: string; reason: string }[] {
  const tier = (c: QueueCandidate) => (c.callbackDueAt && c.callbackDueAt < dayEnd ? 0 : c.nextFollowUpAt && c.nextFollowUpAt < dayEnd ? 1 : 2);
  return [...cands]
    .sort((a, b) => {
      const t = tier(a) - tier(b);
      if (t) return t;
      if (tier(a) < 2) {
        const da = (a.callbackDueAt ?? a.nextFollowUpAt)!.getTime();
        const dbb = (b.callbackDueAt ?? b.nextFollowUpAt)!.getTime();
        if (da !== dbb) return da - dbb;
      }
      return (
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        a.callCount - b.callCount ||
        (b.score ?? -1) - (a.score ?? -1) ||
        a.discoveredAt.getTime() - b.discoveredAt.getTime()
      );
    })
    .map((c) => {
      const t = tier(c);
      const reason =
        t === 0 ? "Callback due" : t === 1 ? "Follow-up due" :
        c.callCount === 0 ? `${c.priority === "HIGH" ? "High priority" : c.priority === "LOW" ? "Low priority" : "Medium priority"}, not called yet` :
        `Attempt ${c.callCount + 1}`;
      return { id: c.id, reason };
    });
}

/**
 * Fill a user's queue for a day up to their goal plus a buffer for unanswered calls.
 * Skips archived and do-not-contact leads, closed deals, leads without a dialable phone,
 * leads at the attempt limit, and leads called too recently (unless a callback is due).
 */
export async function buildQueue({ userId, day, replace }: { userId: string; day: string; replace?: boolean }) {
  const [user, sales] = await Promise.all([db.user.findUniqueOrThrow({ where: { id: userId } }), getSetting("sales")]);
  if (replace) await db.callQueueItem.deleteMany({ where: { userId, day, status: "PENDING" } });
  const existingItems = await db.callQueueItem.findMany({ where: { userId, day }, select: { companyId: true, position: true } });
  const target = Math.ceil(user.dailyCallGoal * 1.5);
  const room = Math.max(0, target - existingItems.length);
  if (room === 0) return { added: 0, existing: existingItems.length };

  const dayEnd = endOfDay(day);
  const retryCutoff = startOfDay(addDays(day, -sales.retryAfterNoAnswerDays + 1));
  const have = new Set(existingItems.map((e) => e.companyId));

  const rows = await db.company.findMany({
    where: {
      archived: false,
      doNotContact: false,
      stage: { notIn: EXCLUDED_STAGES as never },
      callCount: { lt: sales.maxCallAttempts },
      OR: [
        { mainPhone: { not: null }, mainPhoneStatus: { not: "INVALID" } },
        { contacts: { some: { phone: { not: null }, phoneStatus: { not: "INVALID" }, doNotContact: false } } },
      ],
    },
    select: {
      id: true, priority: true, score: true, callCount: true, lastContactedAt: true, nextFollowUpAt: true, discoveredAt: true, stage: true,
      tasks: { where: { completedAt: null, type: "CALLBACK" }, orderBy: { dueAt: "asc" }, take: 1, select: { dueAt: true } },
      contacts: { where: { phone: { not: null }, phoneStatus: { not: "INVALID" }, doNotContact: false }, orderBy: [{ isPrimary: "desc" }, { isDecisionMaker: "desc" }], take: 1, select: { id: true } },
    },
  });

  const candidates: (QueueCandidate & { contactId: string | null })[] = rows
    .filter((r) => !have.has(r.id))
    .map((r) => ({ ...r, callbackDueAt: r.tasks[0]?.dueAt ?? null, contactId: r.contacts[0]?.id ?? null }))
    .filter((r) => {
      const dueToday = (r.callbackDueAt && r.callbackDueAt < dayEnd) || (r.nextFollowUpAt && r.nextFollowUpAt < dayEnd);
      if (dueToday) return true;
      // Leave a lead alone while a future follow-up is scheduled, and after a recent attempt.
      if (r.nextFollowUpAt && r.nextFollowUpAt >= dayEnd) return false;
      if (r.callbackDueAt && r.callbackDueAt >= dayEnd) return false;
      return !r.lastContactedAt || r.lastContactedAt < retryCutoff;
    });

  const ranked = rankCandidates(candidates, dayEnd).slice(0, room);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  let pos = existingItems.reduce((m, e) => Math.max(m, e.position), 0);
  await db.callQueueItem.createMany({
    data: ranked.map((r) => ({ day, userId, companyId: r.id, contactId: byId.get(r.id)?.contactId ?? null, position: ++pos, reason: r.reason })),
    skipDuplicates: true,
  });
  return { added: ranked.length, existing: existingItems.length };
}
