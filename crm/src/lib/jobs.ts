import { dayKey, weekday } from "./dates";
import { db } from "./db";
import { advanceEnrollments } from "./outreach";
import { buildQueue } from "./queue";

/**
 * Daily housekeeping, run by Vercel Cron (once a day on the Hobby plan) or `npm run jobs:run`.
 * It only drafts and organizes; it never sends email.
 */
export async function runDailyJobs() {
  const now = new Date();
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
  return { sequences, queues, expiredSessions: sessions.count, rateLimitsCleared: limits.count };
}
