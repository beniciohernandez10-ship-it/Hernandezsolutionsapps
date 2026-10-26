import { createHash } from "node:crypto";
import { z } from "zod";
import { asSystem } from "../db";
import { config } from "../config";
import { enqueue } from "../jobs-queue";
import { log } from "../log";
import { ProviderError, providerFetch, readJsonResponse, type HttpPolicy } from "../integrations/http";
import { attachmentStorage } from "./storage";

/**
 * Malware scanning. Every stored file starts "pending" and can't be
 * downloaded until this job marks it clean:
 *
 * - The built-in engine always runs. It knows the EICAR test signature, so
 *   quarantine can be tested without a provider. It is not an antivirus.
 * - With CLOUDMERSIVE_API_KEY set, the file is also sent to Cloudmersive's
 *   virus scan API (stateless: it doesn't keep the file).
 * - A file with malware is quarantined: its bytes are deleted, the record
 *   stays, and the event is audited. Identical files (same SHA-256) reuse a
 *   recent verdict from the same engines instead of being sent again.
 * - Provider errors retry with backoff; when retries run out the file stays
 *   unavailable as "scan_failed" until someone retries it.
 */

export type ScanStatus = "pending" | "clean" | "quarantined" | "scan_failed";

export interface ScanVerdict {
  infected: boolean;
  findings: string[];
}

const CLOUDMERSIVE = "https://api.cloudmersive.com/virus/scan/file";
let testFetch: typeof fetch | null = null;
/** Test hook: route provider calls to a fake. */
export function setScanFetchForTesting(f: typeof fetch | null) {
  testFetch = f;
}
const policy = (): HttpPolicy => ({ allowedHosts: ["api.cloudmersive.com"], timeoutMs: 60_000, fetchImpl: testFetch ?? undefined });

/** Engines that decide, as recorded on the file. Verdicts are only reused between identical engine sets. */
export const engineLabel = () => (config().scanning.cloudmersiveApiKey ? "built-in + Cloudmersive" : "built-in");
export const antivirusConfigured = () => Boolean(config().scanning.cloudmersiveApiKey);

// Assembled at runtime so this source file itself never matches the signature.
const EICAR = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-", "ANTIVIRUS-TEST-FILE!$H+H*"].join("");

export function builtInScan(data: Uint8Array): ScanVerdict {
  const found = Buffer.from(data.buffer, data.byteOffset, data.byteLength).includes(EICAR, 0, "latin1");
  return { infected: found, findings: found ? ["EICAR-Test-File"] : [] };
}

const cloudmersiveResult = z.object({
  CleanResult: z.boolean(),
  FoundViruses: z.array(z.object({ FileName: z.string().nullish(), VirusName: z.string().nullish() })).nullish(),
});

async function cloudmersiveScan(data: Uint8Array, filename: string, apiKey: string): Promise<ScanVerdict> {
  const form = new FormData();
  form.append("inputFile", new Blob([data as BlobPart]), filename);
  let res: Response;
  try {
    res = await providerFetch(CLOUDMERSIVE, { method: "POST", headers: { Apikey: apiKey, accept: "application/json" }, body: form }, policy());
  } catch (err) {
    // A scan changes nothing on the provider's side, so an unclear outcome is just a retry.
    if (err instanceof ProviderError && err.opts.ambiguous) throw new ProviderError(err.message, { ...err.opts, ambiguous: false, retryable: true });
    throw err;
  }
  if (res.status === 401 || res.status === 403) throw new ProviderError("The antivirus service rejected the API key.", { status: res.status, retryable: false });
  if (!res.ok) throw new ProviderError(`The antivirus service returned ${res.status}.`, { status: res.status, retryable: res.status === 429 });
  const parsed = cloudmersiveResult.safeParse(await readJsonResponse(res, 1024 * 1024));
  if (!parsed.success) throw new ProviderError("The antivirus service returned an unexpected answer.", { retryable: true });
  if (parsed.data.CleanResult) return { infected: false, findings: [] };
  const names = (parsed.data.FoundViruses ?? []).map((v) => v.VirusName?.trim()).filter((v): v is string => Boolean(v));
  return { infected: true, findings: names.length ? names : ["Malware (unnamed)"] };
}

/** Runs every configured engine; stops at the first that finds something. */
export async function scanBytes(data: Uint8Array, filename: string): Promise<ScanVerdict> {
  const local = builtInScan(data);
  if (local.infected) return local;
  const key = config().scanning.cloudmersiveApiKey;
  return key ? cloudmersiveScan(data, filename, key) : local;
}

async function readAll(stream: ReadableStream<Uint8Array>, max: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const jobPayload = z.object({ attachmentId: z.uuid(), notify: z.boolean().optional() });

type Row = {
  id: string;
  ticket_id: string;
  customer_id: string;
  uploader_user_id: string;
  visibility: string;
  filename: string;
  sha256: string;
  storage_key: string;
  size_bytes: number;
  scan_status: ScanStatus;
};

const REUSE_DAYS = 30;

/** Job handler for attachment.scan. `final` is true on the job's last attempt. */
export async function scanAttachment(payload: unknown, opts: { final?: boolean } = {}) {
  const { attachmentId, notify } = jobPayload.parse(payload);
  const row = await asSystem(async (tx) => {
    const r = await tx.query<Row>("select * from ticket_attachments where id = $1 and deleted_at is null", [attachmentId]);
    return r.rows[0];
  });
  if (!row || row.scan_status !== "pending") return { skipped: true };
  const engine = engineLabel();

  // A verdict on identical bytes from the same engines: quarantine always carries over, clean only if recent.
  const prior = await asSystem(async (tx) => {
    const r = await tx.query<{ scan_status: ScanStatus; scan_detail: string | null }>(
      `select scan_status, scan_detail from ticket_attachments
        where sha256 = $1 and id <> $2 and scan_engine = $3
          and (scan_status = 'quarantined' or (scan_status = 'clean' and scanned_at > now() - make_interval(days => $4)))
        order by scan_status = 'quarantined' desc, scanned_at desc limit 1`,
      [row.sha256, row.id, engine, REUSE_DAYS],
    );
    return r.rows[0];
  });

  let verdict: ScanVerdict;
  if (prior) {
    verdict = { infected: prior.scan_status === "quarantined", findings: prior.scan_status === "quarantined" ? (prior.scan_detail ?? "Malware").split(", ") : [] };
  } else {
    const stream = await attachmentStorage().get(row.storage_key);
    const data = stream ? await readAll(stream, 11 * 1024 * 1024) : null;
    if (!data) return finish(row, { status: "scan_failed", detail: "The file is missing from storage.", engine });
    if (createHash("sha256").update(data).digest("hex") !== row.sha256) {
      // Not the bytes that were uploaded: never serve them. (Not a quarantine, which identical uploads would inherit.)
      return finish(row, { status: "scan_failed", detail: "The stored file doesn't match what was uploaded.", engine });
    }
    try {
      verdict = await scanBytes(data, row.filename);
    } catch (err) {
      const retry = err instanceof ProviderError && err.opts.retryable && !opts.final;
      log.warn("attachment.scan_error", { attachmentId, retry, error: (err as Error).message });
      if (retry) throw err;
      return finish(row, { status: "scan_failed", detail: err instanceof ProviderError ? err.message : "The scan failed.", engine });
    }
  }
  if (verdict.infected) return finish(row, { status: "quarantined", detail: verdict.findings.join(", "), engine });
  return finish(row, { status: "clean", detail: null, engine }, notify !== false);
}

async function finish(row: Row, r: { status: Exclude<ScanStatus, "pending">; detail: string | null; engine: string }, notify = false) {
  const changed = await asSystem(async (tx) => {
    const u = await tx.query(
      `update ticket_attachments set scan_status = $2, scan_detail = $3, scan_engine = $4, scanned_at = now()
        where id = $1 and scan_status = 'pending'`,
      [row.id, r.status, r.detail?.slice(0, 500) ?? null, r.engine],
    );
    if (!u.rowCount) return false;
    if (r.status === "clean" && notify) {
      // The "new file" notification waits until the file can actually be opened.
      await enqueue(tx, "notify.ticket", row.customer_id, {
        ticketId: row.ticket_id,
        event: "attachment_added",
        actorUserId: row.uploader_user_id,
        detail: row.visibility,
        ref: null,
      });
    }
    if (r.status !== "clean") {
      await tx.query(
        `insert into audit_events (actor_user_id, customer_id, action, outcome, target_type, target_id, details)
         values (null, $1, $2, 'failure', 'attachment', $3, $4)`,
        [
          row.customer_id,
          r.status === "quarantined" ? "attachment.quarantined" : "attachment.scan_failed",
          row.id,
          JSON.stringify({ ticketId: row.ticket_id, uploader: row.uploader_user_id, sha256: row.sha256, detail: r.detail, engine: r.engine }),
        ],
      );
    }
    return true;
  });
  if (changed && r.status === "quarantined") {
    log.warn("attachment.quarantined", { attachmentId: row.id, customerId: row.customer_id, detail: r.detail });
    // Only the record is kept; the bytes are gone.
    await attachmentStorage().delete(row.storage_key).catch(() => undefined);
  }
  return { status: r.status };
}

/** Staff action: scan a file again after a failed scan. */
export async function requeueScan(attachmentId: string, customerId: string) {
  await asSystem(async (tx) => {
    const u = await tx.query(
      "update ticket_attachments set scan_status = 'pending', scan_detail = null where id = $1 and customer_id = $2 and scan_status = 'scan_failed' and deleted_at is null",
      [attachmentId, customerId],
    );
    if (!u.rowCount) return;
    // A fresh dedupe key: the first job for this file may still be on record.
    await enqueue(tx, "attachment.scan", customerId, { attachmentId, notify: false }, `scan:${attachmentId}:${Date.now()}`);
  });
}

/** Scans that never got a job (or lost it): safety net for the daily housekeeping run. */
export async function enqueueMissingScans() {
  await asSystem((tx) =>
    tx.query(
      `insert into jobs (kind, customer_id, payload, dedupe_key)
       select 'attachment.scan', a.customer_id, jsonb_build_object('attachmentId', a.id, 'notify', false), 'scan:' || a.id::text || ':sweep:' || to_char(now(), 'YYYY-MM-DD')
         from ticket_attachments a
        where a.scan_status = 'pending' and a.deleted_at is null and a.created_at < now() - interval '15 minutes'
          and not exists (select 1 from jobs j where j.kind = 'attachment.scan' and j.payload->>'attachmentId' = a.id::text and j.status in ('queued', 'running', 'failed'))
       on conflict (dedupe_key) do nothing`,
    ),
  );
}
