import { asSystem } from "./db";
import { AppError } from "./errors";

/**
 * Fixed-window rate limiter backed by PostgreSQL, so limits are shared across
 * serverless instances and survive restarts.
 */
export async function rateLimit(bucket: string, limit: number, windowSeconds: number) {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const r = await asSystem((tx) =>
    tx.query<{ count: number }>(
      `insert into rate_limits (bucket, window_start, count) values ($1, $2, 1)
       on conflict (bucket, window_start) do update set count = rate_limits.count + 1
       returning count`,
      [bucket, windowStart],
    ),
  );
  const count = Number(r.rows[0].count);
  if (count > limit) {
    const retryAfter = Math.ceil((windowStart.getTime() + windowSeconds * 1000 - Date.now()) / 1000);
    throw new AppError(429, "rate_limited", "Too many requests. Please wait a moment and try again.", { retryAfter });
  }
  return { count, limit };
}
