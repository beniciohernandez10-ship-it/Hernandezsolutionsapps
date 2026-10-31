import { ensureRenewalTasks, sendDigests } from "./digest";
import { syncInbox } from "./inbox/sync";
import { dayKey, weekday } from "./dates";
import { db } from "./db";
import { advanceEnrollments } from "./outreach";
import { buildQueue } from "./queue";

/**
 * Daily housekeeping, run by Vercel Cron (once a day on the Hobby plan) or `npm run jobs:run`.
 * It drafts and organizes; it never emails a prospect. The only email it sends is the team's morning digest.
 */
export async function runDailyJobs() {
  const now = new Date();
  // First, so a reply or opt-out that came in overnight stops the next draft.
  const inbox = await syncInbox({ force: true, now });
  const renewalTasks = await ensureRenewalTasks(now);
  const sequences = await advanceEnrollments(now);
  const today = dayKey(now);
  const queues: Record<string, number> = {};
  if (weekday(today) !== 0 && weekday(today) !== 6) {
    const users = await db.user.findMany({ where: { active: true, role: { in: ["OWNER", "ADMIN", "SALES"] } }, select: { id: true, email: true } });
    for (const u of users) {
      const r = await buildQueue({ userId: u.id, day: today });
      queues[u.email] = r.added + r.existing;
    }
  }
  const [sessions, limits] = await Promise.all([
    db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.rateLimit.deleteMany({ where: { resetAt: { lt: now } } }),
  ]);
  const digests = await sendDigests(now);
  return { inbox, renewalTasks, sequences, queues, digests, expiredSessions: sessions.count, rateLimitsCleared: limits.count };
}
