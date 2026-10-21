import { asSystem } from "./db";
import { enqueue } from "./jobs-queue";
import { log, errorSummary } from "./log";
import { ProviderError } from "./integrations/http";
import { syncIntuneDevices } from "./integrations/graph";
import { syncAteraAgents, verifyAteraMapping } from "./integrations/atera";
import { purgeExpiredAuthState } from "./auth/session";
import { fanOutChangeEvent, fanOutTicketEvent, notifySlaEvents, sendNotificationEmail } from "./notify/service";
import { sweepSla } from "./sla/service";
import { autoCloseResolved } from "./tickets/service";
import { ingestInboundEmail } from "./email/inbound";

export { enqueue };

/**
 * Durable job queue / transactional outbox in PostgreSQL.
 *
 * - Jobs are inserted in the same transaction as the change that needs them.
 * - Workers claim jobs with FOR UPDATE SKIP LOCKED, so concurrent runners
 *   (several cron invocations, a manual run) never process the same job twice
 *   at the same time. Delivery is at-least-once, not exactly-once.
 * - A job whose provider write may or may not have happened (timeout, 5xx on
 *   a non-idempotent call) is moved to needs_review and never retried
 *   automatically.
 */

export type Job = {
  id: string;
  kind: string;
  customer_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

type Handler = (job: Job) => Promise<unknown>;

const handlers = new Map<string, Handler>([
  ["intune.sync_devices", (j) => syncIntuneDevices(j.customer_id!)],
  ["atera.verify_mapping", (j) => verifyAteraMapping(j.customer_id!, String(j.payload.connectionId))],
  ["atera.sync_agents", (j) => syncAteraAgents(j.customer_id!)],
  ["notify.ticket", (j) => fanOutTicketEvent(j.payload)],
  ["notify.change", (j) => fanOutChangeEvent(j.payload)],
  ["email.notification", (j) => sendNotificationEmail(j.payload)],
  ["email.ingest", (j) => ingestInboundEmail(String(j.payload.inboundId))],
  // One sweep for time-based ticket rules: SLA warnings/breaches and closing resolved tickets.
  [
    "sla.sweep",
    async () => {
      await notifySlaEvents(await sweepSla());
      await autoCloseResolved();
    },
  ],
  [
    "atera.ticket_write",
    async () => {
      // Bidirectional sync is gated until the contract and the policies in
      // docs/atera-sync-design.md are verified with the live account.
      throw new ProviderError("Atera ticket writes are not enabled in this release.", { retryable: false, ambiguous: false });
    },
  ],
]);

export function registerJobHandler(kind: string, h: Handler) {
  handlers.set(kind, h);
}

export async function claimJobs(limit = 5, lockSeconds = 300): Promise<Job[]> {
  return asSystem(async (tx) => {
    const r = await tx.query<Job>(
      `update jobs set status = 'running', attempts = attempts + 1, locked_until = now() + make_interval(secs => $2), updated_at = now()
        where id in (
          select id from jobs
           where (status in ('queued', 'failed') and run_after <= now())
              or (status = 'running' and locked_until < now())
           order by run_after
           limit $1
           for update skip locked)
        returning id, kind, customer_id, payload, attempts, max_attempts`,
      [limit, lockSeconds],
    );
    return r.rows;
  });
}

async function finish(job: Job, status: string, error?: string, retryInSeconds?: number) {
  await asSystem((tx) =>
    tx.query(
      `update jobs set status = $2, last_error = $3, locked_until = null, updated_at = now(),
              run_after = case when $4::int is null then run_after else now() + make_interval(secs => $4::int) end
        where id = $1`,
      [job.id, status, error?.slice(0, 500) ?? null, retryInSeconds ?? null],
    ),
  );
}

export async function runJob(job: Job) {
  const h = handlers.get(job.kind);
  if (!h) return finish(job, "dead", `No handler for ${job.kind}`);
  try {
    await h(job);
    await finish(job, "succeeded");
  } catch (err) {
    const pe = err instanceof ProviderError ? err : undefined;
    const message = pe?.message ?? "Unexpected error.";
    log.warn("job.failed", { jobId: job.id, kind: job.kind, attempts: job.attempts, error: errorSummary(err) });
    if (pe?.opts.ambiguous) return finish(job, "needs_review", `Ambiguous outcome, not retried: ${message}`);
    if (pe && !pe.opts.retryable) return finish(job, "dead", message);
    if (job.attempts >= job.max_attempts) return finish(job, "dead", message);
    const backoff = Math.max(Math.ceil((pe?.opts.retryAfterMs ?? 0) / 1000), Math.min(3600, 30 * 2 ** job.attempts));
    await finish(job, "failed", message, backoff);
  }
}

export async function processJobs(opts: { limit?: number; deadlineMs?: number } = {}) {
  const deadline = Date.now() + (opts.deadlineMs ?? 45_000);
  let processed = 0;
  while (Date.now() < deadline) {
    const batch = await claimJobs(Math.min(5, (opts.limit ?? 20) - processed));
    if (batch.length === 0) break;
    for (const job of batch) await runJob(job);
    processed += batch.length;
    if (processed >= (opts.limit ?? 20)) break;
  }
  return { processed };
}

/** Enqueues periodic read-only syncs, deduplicated per hour. */
export async function scheduleSyncs(now = new Date()) {
  const bucket = now.toISOString().slice(0, 13);
  await asSystem(async (tx) => {
    const intune = await tx.query<{ customer_id: string }>(
      `select distinct ced.customer_id from customer_entra_directories ced
         join entra_directories d on d.id = ced.directory_id join customers c on c.id = ced.customer_id
        where ced.inventory_enabled and d.inventory_consent_at is not null and c.status = 'active'`,
    );
    for (const r of intune.rows) await enqueue(tx, "intune.sync_devices", r.customer_id, {}, `intune.sync:${r.customer_id}:${bucket}`);
    const atera = await tx.query<{ customer_id: string }>(
      `select distinct m.customer_id from customer_atera_mappings m join atera_connections c on c.id = m.connection_id
         join customers cu on cu.id = m.customer_id where m.verified_at is not null and c.enabled and cu.status = 'active'`,
    );
    for (const r of atera.rows) await enqueue(tx, "atera.sync_agents", r.customer_id, {}, `atera.agents:${r.customer_id}:${bucket}`);
  });
}

/** Enqueues an SLA sweep, at most once per minute however often it is asked for. */
export async function scheduleSlaSweep(now = new Date()) {
  await asSystem((tx) => enqueue(tx, "sla.sweep", null, {}, `sla.sweep:${now.toISOString().slice(0, 16)}`));
}

/** Deletes finished jobs and expired reply addresses after a retention period. */
export async function housekeeping() {
  await asSystem(async (tx) => {
    await tx.query("delete from jobs where status = 'succeeded' and updated_at < now() - interval '14 days'");
    await tx.query("delete from email_reply_tokens where expires_at < now()");
  });
}

/**
 * Runs queued work right after a request finishes (Next.js after()), so
 * notifications go out within seconds instead of waiting for the daily cron.
 * Safe to call often: claiming uses SKIP LOCKED and the sweep is deduplicated.
 */
export async function drainSoon(opts: { sweep?: boolean } = {}) {
  try {
    if (opts.sweep) await scheduleSlaSweep();
    await processJobs({ limit: 20, deadlineMs: 8_000 });
  } catch (err) {
    log.error("jobs.drain_failed", { error: errorSummary(err) });
  }
}

export async function cronTick() {
  await scheduleSyncs();
  await scheduleSlaSweep();
  const result = await processJobs();
  try {
    await purgeExpiredAuthState();
    await housekeeping();
  } catch (err) {
    log.error("housekeeping.failed", { error: errorSummary(err) });
  }
  return result;
}
