import { after } from "next/server";
import { asSystem, openDatabase, type Database } from "../db";
import { requireOperator, type Principal } from "../authz";
import { config } from "../config";
import { log, errorSummary } from "../log";

/**
 * Off-site audit log (docs/audit-log.md).
 *
 * audit_events in the main database stays the working copy the portal reads.
 * Every row is also sent to a separate PostgreSQL database where the portal's
 * login (audit_writer) can only append through audit_append(): it can't read,
 * change or delete what is there. Rows are hash-chained in the store, and the
 * chain head after each send is kept here as a checkpoint, so tampering needs
 * both databases and is caught by verifyAuditStore().
 *
 * Delivery is at-least-once: rows are marked exported only after the store
 * confirms them, and the store skips ids it already has.
 */

const SOURCE = "it-center";

const g = globalThis as unknown as { __itcAuditStore?: Promise<Database> | null };

/** The store connection, or null when AUDIT_DATABASE_URL isn't set. */
export function auditStore(): Promise<Database> | null {
  if (g.__itcAuditStore !== undefined) return g.__itcAuditStore;
  const url = config().audit.databaseUrl;
  g.__itcAuditStore = url ? openDatabase(url) : null;
  return g.__itcAuditStore;
}

/** Test hook: a store handle, null for "not configured", undefined to reset. */
export function setAuditStoreForTesting(store: Database | null | undefined) {
  g.__itcAuditStore = store === undefined ? undefined : store ? Promise.resolve(store) : null;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

async function recordError(err: unknown) {
  log.error("audit.ship_failed", { error: errorSummary(err) });
  await asSystem((tx) => tx.query("update audit_shipping set last_error = $1, last_error_at = now() where id", [message(err)])).catch(() => undefined);
}

/** Sends audit events that haven't reached the store yet. Never throws. */
export async function shipAuditEvents(opts: { batch?: number; deadlineMs?: number } = {}) {
  const pending = auditStore();
  if (!pending) return { configured: false, shipped: 0 };
  const batch = opts.batch ?? 500;
  const deadline = Date.now() + (opts.deadlineMs ?? 8_000);
  let shipped = 0;
  try {
    const store = await pending;
    while (Date.now() < deadline) {
      // "at" as text keeps full microsecond precision for the store's hash.
      const rows = await asSystem((tx) =>
        tx.query<{ id: string }>(
          `select id, at::text as at, actor_user_id, customer_id, action, target_type, target_id, outcome, details, request_id
             from audit_events where exported_at is null order by id limit $1`,
          [batch],
        ),
      );
      if (!rows.rows.length) break;
      const head = await store.query<{ head_seq: string; head_hash: string }>("select head_seq, head_hash from audit_append($1, $2::jsonb)", [
        SOURCE,
        JSON.stringify(rows.rows),
      ]);
      await asSystem(async (tx) => {
        await tx.query("update audit_events set exported_at = now() where id = any($1::bigint[]) and exported_at is null", [rows.rows.map((r) => r.id)]);
        await tx.query("update audit_shipping set last_shipped_at = now(), store_seq = $1, store_hash = $2, last_error = null, last_error_at = null where id", [
          head.rows[0].head_seq,
          head.rows[0].head_hash,
        ]);
      });
      shipped += rows.rows.length;
      if (rows.rows.length < batch) break;
    }
  } catch (err) {
    await recordError(err);
  }
  return { configured: true, shipped };
}

/** Ships right after the response is sent; outside a request it does nothing (cron catches up). */
export function shipAuditAfterResponse() {
  if (!auditStore()) return;
  try {
    after(() => shipAuditEvents());
  } catch {
    // Not inside a request scope.
  }
}

export interface AuditVerification {
  ok: boolean;
  records: number;
  note: string | null;
}

/**
 * Recomputes the store's hash chain and compares it with the checkpoint kept
 * in this database. Records the result for operators; logs an error on failure.
 */
export async function verifyAuditStore(): Promise<AuditVerification | null> {
  const pending = auditStore();
  if (!pending) return null;
  let result: AuditVerification;
  try {
    const store = await pending;
    const v = (await store.query<{ checked: string; ok: boolean; first_bad_seq: string | null; head_seq: string }>("select * from audit_verify()")).rows[0];
    const cp = (await asSystem((tx) => tx.query<{ store_seq: string | null; store_hash: string | null }>("select store_seq, store_hash from audit_shipping where id"))).rows[0];
    result = { ok: v.ok, records: Number(v.checked), note: v.ok ? null : `The chain breaks at record ${v.first_bad_seq}: a record was changed, removed or reordered.` };
    if (result.ok && cp?.store_seq && cp.store_hash) {
      if (Number(v.head_seq) < Number(cp.store_seq)) {
        result = { ...result, ok: false, note: `The store has ${v.head_seq} records but ${cp.store_seq} were confirmed earlier: records were removed.` };
      } else {
        const at = (await store.query<{ h: string | null }>("select audit_hash_at($1) as h", [cp.store_seq])).rows[0]?.h;
        if (at !== cp.store_hash) {
          result = { ...result, ok: false, note: `Record ${cp.store_seq} no longer matches the checkpoint kept in the portal database: the store was rewritten.` };
        }
      }
    }
  } catch (err) {
    log.error("audit.verify_error", { error: errorSummary(err) });
    result = { ok: false, records: 0, note: `Couldn't check the audit store: ${message(err)}` };
  }
  if (!result.ok) log.error("audit.verify_failed", { note: result.note });
  await asSystem((tx) =>
    tx.query("update audit_shipping set last_verified_at = now(), last_verify_ok = $1, last_verify_note = $2 where id", [result.ok, result.note]),
  );
  return result;
}

export interface AuditStatus {
  configured: boolean;
  pending: number;
  oldestPendingAt: string | null;
  lastShippedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  storeRecords: number | null;
  lastVerifiedAt: string | null;
  lastVerifyOk: boolean | null;
  lastVerifyNote: string | null;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export async function auditStatus(p: Principal): Promise<AuditStatus> {
  requireOperator(p);
  return asSystem(async (tx) => {
    const pend = (await tx.query<{ n: string; oldest: string | null }>("select count(*) as n, min(at) as oldest from audit_events where exported_at is null")).rows[0];
    const s = (await tx.query<Record<string, unknown>>("select * from audit_shipping where id")).rows[0] ?? {};
    return {
      configured: Boolean(auditStore()),
      pending: Number(pend.n),
      oldestPendingAt: iso(pend.oldest),
      lastShippedAt: iso(s.last_shipped_at),
      lastError: (s.last_error as string) ?? null,
      lastErrorAt: iso(s.last_error_at),
      storeRecords: s.store_seq == null ? null : Number(s.store_seq),
      lastVerifiedAt: iso(s.last_verified_at),
      lastVerifyOk: (s.last_verify_ok as boolean) ?? null,
      lastVerifyNote: (s.last_verify_note as string) ?? null,
    };
  });
}

/** Operator action: send anything waiting, then check the chain. */
export async function checkAuditNow(p: Principal) {
  requireOperator(p);
  if (!auditStore()) return { configured: false as const };
  const sent = await shipAuditEvents({ deadlineMs: 20_000 });
  return { configured: true as const, shipped: sent.shipped, verification: await verifyAuditStore() };
}
