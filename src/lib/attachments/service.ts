import { createHash, randomBytes } from "node:crypto";
import { withUser, type Queryable } from "../db";
import { isStaffFor, requireMember, type Principal } from "../authz";
import { AppError, forbidden, notFound } from "../errors";
import { config } from "../config";
import { attachmentStorage } from "./storage";
import { requeueScan, type ScanStatus } from "./scan";
import { AttachmentRejected, checkAttachment } from "./validate";

export interface AttachmentInfo {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  visibility: "public" | "internal";
  uploaderName: string;
  messageId: string | null;
  source: "portal" | "email";
  /** Only "clean" files can be opened. */
  scanStatus: ScanStatus;
  /** Staff only: what the scan found, or why it failed. */
  scanDetail: string | null;
  inline: boolean;
  createdAt: string;
}

const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function toInfo(r: Record<string, unknown>): AttachmentInfo {
  return {
    id: r.id as string,
    filename: r.filename as string,
    contentType: r.content_type as string,
    sizeBytes: Number(r.size_bytes),
    visibility: r.visibility as "public" | "internal",
    uploaderName: (r.uploader_name as string) ?? "Someone",
    messageId: (r.message_id as string) ?? null,
    source: r.source as "portal" | "email",
    scanStatus: r.scan_status as ScanStatus,
    scanDetail: (r.scan_detail as string) ?? null,
    inline: INLINE.has(r.content_type as string),
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

/** Attachments of one ticket the principal may see (RLS also hides internal files from customers). */
export async function listAttachments(tx: Queryable, p: Principal, ticketId: string, customerId: string): Promise<AttachmentInfo[]> {
  const staff = isStaffFor(p, customerId);
  const r = await tx.query(
    `select a.*, u.display_name as uploader_name from ticket_attachments a join users u on u.id = a.uploader_user_id
      where a.ticket_id = $1 and a.customer_id = $2 and a.deleted_at is null ${staff ? "" : "and a.visibility = 'public'"}
      order by a.created_at, a.id`,
    [ticketId, customerId],
  );
  return r.rows.map((row) => ({ ...toInfo(row), scanDetail: staff ? ((row.scan_detail as string) ?? null) : null }));
}

export interface StoreInput {
  ticketId: string;
  filename: string;
  data: Uint8Array;
  visibility: "public" | "internal";
  messageId?: string | null;
  source?: "portal" | "email";
  maxBytes?: number;
}

/**
 * Validates and stores one file in the user's transaction. The bytes are
 * written before the row; if the transaction then fails, the orphaned blob is
 * removed. The file is queued for a malware scan; notifications are sent once
 * it is clean, unless the caller handles them itself.
 */
export async function storeAttachment(tx: Queryable, p: Principal, input: StoreInput, opts: { notify?: boolean } = {}) {
  const t = await tx.query<{ customer_id: string; status: string }>("select customer_id, status from tickets where id = $1", [input.ticketId]);
  if (!t.rows[0]) throw notFound("Ticket");
  const customerId = t.rows[0].customer_id;
  requireMember(p, customerId);
  if (input.visibility === "internal" && !isStaffFor(p, customerId)) throw forbidden("Only technicians can add private files.");

  let accepted;
  try {
    accepted = checkAttachment(input.filename, input.data, input.maxBytes ?? config().attachments.maxUploadBytes);
  } catch (err) {
    if (err instanceof AttachmentRejected) throw new AppError(422, "validation_failed", err.message, { field: "file" });
    throw err;
  }
  const sha256 = createHash("sha256").update(input.data).digest("hex");
  const key = `tickets/${customerId}/${input.ticketId}/${randomBytes(16).toString("hex")}`;
  const storage = attachmentStorage();
  await storage.put(key, input.data, accepted.contentType);
  try {
    const r = await tx.query<{ id: string }>(
      `insert into ticket_attachments (ticket_id, customer_id, message_id, uploader_user_id, visibility, filename, content_type, size_bytes, sha256, storage_key, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [input.ticketId, customerId, input.messageId ?? null, p.userId, input.visibility, accepted.filename, accepted.contentType, input.data.byteLength, sha256, key, input.source ?? "portal"],
    );
    await tx.query(
      "insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, to_value) values ($1, $2, $3, 'attachment_added', $4)",
      [input.ticketId, customerId, p.userId, input.visibility],
    );
    await tx.query("update tickets set updated_at = now(), version = version + 1 where id = $1", [input.ticketId]);
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'ticket.attachment', 'ticket', $3, $4)",
      [p.userId, customerId, input.ticketId, JSON.stringify({ attachmentId: r.rows[0].id, size: input.data.byteLength, type: accepted.contentType, visibility: input.visibility })],
    );
    // Nobody can open the file until the scan marks it clean; the "new file" notification waits for that too.
    await tx.query("select app_enqueue_attachment_scan($1, $2)", [r.rows[0].id, opts.notify !== false]);
    return { id: r.rows[0].id, filename: accepted.filename, scanStatus: "pending" as const };
  } catch (err) {
    await storage.delete(key).catch(() => undefined);
    throw err;
  }
}

/** Upload from the portal: one file per request. */
export async function uploadAttachment(p: Principal, input: StoreInput) {
  return withUser(p.userId, (tx) => storeAttachment(tx, p, { ...input, source: "portal" }));
}

/**
 * Authorised read. Visibility is decided by the same rules as messages: the
 * ticket must be visible, and internal files only to staff. Invisible and
 * nonexistent attachments are indistinguishable.
 */
export async function openAttachment(p: Principal, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("File");
  const row = await withUser(p.userId, async (tx) => {
    const r = await tx.query<Record<string, unknown>>(
      `select a.* from ticket_attachments a join tickets t on t.id = a.ticket_id
        where a.id = $1 and a.deleted_at is null`,
      [id],
    );
    const a = r.rows[0];
    if (!a) return null;
    const customerId = a.customer_id as string;
    if (!p.memberships.some((m) => m.customerId === customerId)) return null;
    if (a.visibility === "internal" && !isStaffFor(p, customerId)) return null;
    // Pending, failed and quarantined files are never served.
    if (a.scan_status !== "clean") return null;
    // Requesters only see their own tickets (RLS on tickets enforces the same).
    const t = await tx.query("select 1 from tickets where id = $1", [a.ticket_id]);
    return t.rows[0] ? a : null;
  });
  if (!row) throw notFound("File");
  const stream = await attachmentStorage().get(row.storage_key as string);
  if (!stream) throw notFound("File");
  return { info: toInfo(row), stream };
}

/** Staff: scan a file again after its scan failed (provider outage, key problem). */
export async function rescanAttachment(p: Principal, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("File");
  const row = await withUser(p.userId, async (tx) => {
    const r = await tx.query<{ customer_id: string; scan_status: string }>(
      "select a.customer_id, a.scan_status from ticket_attachments a join tickets t on t.id = a.ticket_id where a.id = $1 and a.deleted_at is null",
      [id],
    );
    return r.rows[0];
  });
  if (!row || !isStaffFor(p, row.customer_id)) throw notFound("File");
  if (row.scan_status !== "scan_failed") throw new AppError(409, "invalid_transition", "Only files whose scan failed can be scanned again.");
  await requeueScan(id, row.customer_id);
  return { scanStatus: "pending" as const };
}
