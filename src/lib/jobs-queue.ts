import type { Queryable } from "./db";

/**
 * Adds a job in the caller's transaction (transactional outbox). Kept apart
 * from jobs.ts so services that enqueue work don't import every job handler.
 */
export async function enqueue(tx: Queryable, kind: string, customerId: string | null, payload: object = {}, dedupeKey?: string) {
  await tx.query(
    `insert into jobs (kind, customer_id, payload, dedupe_key) values ($1, $2, $3, $4)
     on conflict (dedupe_key) do nothing`,
    [kind, customerId, JSON.stringify(payload), dedupeKey ?? null],
  );
}
