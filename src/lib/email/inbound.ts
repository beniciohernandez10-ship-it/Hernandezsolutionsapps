import { createHmac, timingSafeEqual } from "node:crypto";
import { decideApproval, parseEmailDecision } from "../catalog/workflow";
import { z } from "zod";
import { asSystem, withUser } from "../db";
import { loadPrincipal, isStaffFor, type Principal } from "../authz";
import { config, emailIntakeEnabled } from "../config";
import { AppError, forbidden, notFound } from "../errors";
import { enqueue } from "../jobs-queue";
import { log, errorSummary } from "../log";
import { ProviderError } from "../integrations/http";
import { addMessage, createTicket } from "../tickets/service";
import { storeAttachment } from "../attachments/service";
import { hashReplyToken } from "../notify/service";
import { REPLY_MARKER } from "./templates";
import { downloadAttachment, getReceivedEmail, listReceivedAttachments, type ReceivedEmail } from "./resend";
import { CATEGORIES, PRIORITIES } from "../tickets/schemas";

/**
 * Email intake (Resend inbound).
 *
 * 1. The webhook is verified (Svix signature over id.timestamp.body, five
 *    minute tolerance) and recorded once per provider email id; nothing else
 *    happens in the request.
 * 2. A job fetches the message from Resend's API and decides:
 *    - sent to a live t-<token>@ reply address, from that token's user, not
 *      failing DMARC → added to the ticket as that user, with the same
 *      permission checks as the portal;
 *    - anything else → "needs review" for a service manager. A sender address
 *      on its own never creates a ticket or a reply.
 */

const TOLERANCE_S = 300;

export function verifySvixSignature(
  rawBody: string,
  h: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!h.id || !h.timestamp || !h.signature || !/^\d+$/.test(h.timestamp)) return false;
  if (Math.abs(nowSeconds - Number(h.timestamp)) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${rawBody}`).digest();
  return h.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

const webhookSchema = z.object({
  type: z.string(),
  data: z
    .object({
      email_id: z.string().min(1).max(100),
      from: z.string().max(500).optional(),
      to: z.array(z.string().max(500)).max(100).optional(),
      subject: z.string().max(2000).nullable().optional(),
      message_id: z.string().max(1000).nullable().optional(),
      attachments: z.array(z.unknown()).max(100).optional(),
    })
    .passthrough(),
});

/** Handles one verified webhook delivery. Returns whether a new email was queued. */
export async function recordInboundWebhook(rawBody: string): Promise<{ queued: boolean }> {
  const evt = webhookSchema.parse(JSON.parse(rawBody));
  if (evt.type !== "email.received") return { queued: false };
  const d = evt.data;
  const from = parseAddress(d.from ?? "");
  return asSystem(async (tx) => {
    const r = await tx.query<{ id: string }>(
      `insert into inbound_emails (provider, provider_email_id, message_id, from_address, from_name, to_addresses, subject, attachment_count)
       values ('resend', $1, $2, $3, $4, $5, $6, $7) on conflict (provider, provider_email_id) do nothing returning id`,
      [d.email_id, d.message_id ?? null, from.address || "unknown", from.name, (d.to ?? []).slice(0, 50), d.subject?.slice(0, 500) ?? null, d.attachments?.length ?? 0],
    );
    if (!r.rows[0]) return { queued: false };
    await enqueue(tx, "email.ingest", null, { inboundId: r.rows[0].id }, `ingest:${r.rows[0].id}`);
    return { queued: true };
  });
}

export function parseAddress(raw: string): { name: string | null; address: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  const address = (m ? m[2] : raw).trim().toLowerCase();
  const name = m && m[1].trim() ? m[1].trim().slice(0, 200) : null;
  return { name, address: /^[^\s@]+@[^\s@]+$/.test(address) ? address : "" };
}

/** Readable text from an email body: plain text preferred, HTML reduced to text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** The new part of a reply: everything above our marker or the quoted original. */
export function extractReply(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = lines[i + 1] ?? "";
    if (l.includes(REPLY_MARKER.slice(0, 20))) break;
    if (/^\s*On\b.*\bwrote:\s*$/i.test(l) || (/^\s*On\b/i.test(l) && /wrote:\s*$/i.test(next))) break;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(l)) break;
    if (/^\s*_{10,}\s*$/.test(l)) break;
    if (/^\s*From:\s.+/i.test(l) && /^\s*(Sent|Date):\s/i.test(next)) break;
    if (/^\s*>/.test(l)) continue;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000);
}

const isAutomatic = (headers: Record<string, string> | null | undefined) => {
  const h = Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  return (
    (h["auto-submitted"] && h["auto-submitted"] !== "no") ||
    ["bulk", "junk", "list", "auto_reply"].includes(h["precedence"] ?? "") ||
    Boolean(h["x-autoreply"] || h["x-autorespond"])
  );
};

function replyTokenFrom(email: ReceivedEmail): string | null {
  const domain = config().email.inboundDomain;
  const all = [...(email.to ?? []), ...(email.cc ?? []), ...(email.received_for ?? [])].map((a) => parseAddress(a).address);
  for (const a of all) {
    const m = /^t-([a-z0-9]{10,40})@(.+)$/.exec(a);
    if (m && m[2] === domain) return m[1];
  }
  return null;
}

async function setStatus(id: string, status: string, fields: { reason?: string; ticketId?: string; userId?: string; body?: string } = {}) {
  await asSystem((tx) =>
    tx.query(
      `update inbound_emails set status = $2, reason = coalesce($3, reason), ticket_id = coalesce($4, ticket_id),
              user_id = coalesce($5, user_id), body_text = coalesce($6, body_text) where id = $1`,
      [id, status, fields.reason?.slice(0, 300) ?? null, fields.ticketId ?? null, fields.userId ?? null, fields.body?.slice(0, 20000) ?? null],
    ),
  );
}

/** Stores an email's attachments on a ticket as the given user. Rejected files are listed, never stored. */
async function attachFromEmail(p: Principal, providerEmailId: string, ticketId: string, messageId: string | null) {
  const rejected: string[] = [];
  const files = (await listReceivedAttachments(providerEmailId)).slice(0, 10);
  for (const f of files) {
    try {
      const data = await downloadAttachment(f.download_url, config().attachments.maxEmailBytes);
      await withUser(p.userId, (tx) =>
        storeAttachment(tx, p, { ticketId, filename: f.filename, data, visibility: "public", messageId, source: "email", maxBytes: config().attachments.maxEmailBytes }, { notify: false }),
      );
    } catch (err) {
      rejected.push(`${f.filename.slice(0, 80)} (${err instanceof AppError || err instanceof ProviderError ? err.message : "could not be stored"})`);
    }
  }
  return rejected;
}

/** Job handler for email.ingest. */
export async function ingestInboundEmail(inboundId: string) {
  const row = await asSystem(async (tx) => (await tx.query<Record<string, unknown>>("select * from inbound_emails where id = $1", [inboundId])).rows[0]);
  if (!row || row.status !== "received") return { skipped: true };
  const email = await getReceivedEmail(row.provider_email_id as string);
  const body = extractReply(email.text?.trim() ? email.text : htmlToText(email.html ?? ""));
  const from = parseAddress(email.from).address;

  if (isAutomatic(email.headers)) return setStatus(inboundId, "discarded", { reason: "Automatic reply (out of office, bounce or list mail)." });
  const ownDomain = config().email.inboundDomain;
  if (ownDomain && from.endsWith(`@${ownDomain}`)) return setStatus(inboundId, "discarded", { reason: "Sent from the IT Center's own address." });

  const token = replyTokenFrom(email);
  if (!token) return setStatus(inboundId, "needs_review", { reason: "New email, not a reply to a ticket.", body });

  const match = await asSystem(async (tx) =>
    (
      await tx.query<{ ticket_id: string; user_id: string; email: string; status: string; approval_id: string | null }>(
        `select r.ticket_id, r.user_id, u.email, u.status, r.approval_id from email_reply_tokens r join users u on u.id = r.user_id
          where r.token_hash = $1 and r.expires_at > now()`,
        [hashReplyToken(token)],
      )
    ).rows[0],
  );
  if (!match) return setStatus(inboundId, "needs_review", { reason: "Reply address is unknown or expired.", body });
  if (match.email.toLowerCase() !== from) {
    return setStatus(inboundId, "needs_review", { reason: "Sent from a different address than the person the email went to.", body, ticketId: match.ticket_id });
  }
  const auth = email.authentication;
  if (auth && (auth.dmarc === "fail" || (auth.spf === "fail" && auth.dkim === "fail"))) {
    return setStatus(inboundId, "needs_review", { reason: "The sender's domain failed email authentication.", body, ticketId: match.ticket_id });
  }
  if (!body) return setStatus(inboundId, "needs_review", { reason: "No reply text found above the quoted message.", ticketId: match.ticket_id });
  const p = await asSystem((tx) => loadPrincipal(tx, match.user_id));
  if (!p) return setStatus(inboundId, "needs_review", { reason: "The sender's account is disabled.", body, ticketId: match.ticket_id });

  if (match.approval_id) {
    // A reply to an approval request decides it.
    const decision = parseEmailDecision(body);
    if (!decision) {
      return setStatus(inboundId, "needs_review", { reason: "Couldn't tell whether this approves or rejects. Start the reply with approve or reject.", body, ticketId: match.ticket_id, userId: p.userId });
    }
    try {
      await decideApproval(p, match.ticket_id, { ...decision, approvalId: match.approval_id }, "email");
      await setStatus(inboundId, "attached", { ticketId: match.ticket_id, userId: p.userId, reason: decision.decision === "approved" ? "Approved by email" : "Rejected by email" });
      return { attached: true };
    } catch (err) {
      if (err instanceof AppError) return setStatus(inboundId, "needs_review", { reason: err.message, body, ticketId: match.ticket_id, userId: p.userId });
      throw err;
    }
  }

  try {
    const m = await addMessage(p, match.ticket_id, { body, visibility: "public" }, { source: "email" });
    const rejected = (email.attachments?.length ?? 0) > 0 ? await attachFromEmail(p, email.id, match.ticket_id, m.id) : [];
    await setStatus(inboundId, "attached", {
      ticketId: match.ticket_id,
      userId: p.userId,
      reason: rejected.length ? `Files not added: ${rejected.join("; ")}` : undefined,
    });
    return { attached: true };
  } catch (err) {
    if (err instanceof AppError) return setStatus(inboundId, "needs_review", { reason: err.message, body, ticketId: match.ticket_id, userId: p.userId });
    log.warn("inbound.ingest_failed", { inboundId, error: errorSummary(err) });
    throw err;
  }
}

// ---------------------------------------------------------------- review inbox (service managers)

function requireReviewer(p: Principal) {
  if (!p.memberships.some((m) => m.role === "service_manager")) throw forbidden("Only service managers can review incoming email.");
}

export interface InboxItem {
  id: string;
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  receivedAt: string;
  reason: string | null;
  bodyText: string | null;
  attachmentCount: number;
  /** People with this address who belong to a customer the reviewer manages. */
  suggestions: { userId: string; name: string; customerId: string; customerName: string }[];
}

export async function listInbox(p: Principal): Promise<InboxItem[]> {
  requireReviewer(p);
  const managed = p.memberships.filter((m) => m.role === "technician" || m.role === "service_manager").map((m) => m.customerId);
  return asSystem(async (tx) => {
    const r = await tx.query<Record<string, unknown>>(
      "select * from inbound_emails where status = 'needs_review' order by received_at desc limit 100",
    );
    const items: InboxItem[] = [];
    for (const x of r.rows) {
      const s = await tx.query<{ id: string; display_name: string; customer_id: string; name: string }>(
        `select u.id, u.display_name, m.customer_id, c.name from users u join memberships m on m.user_id = u.id and m.revoked_at is null
           join customers c on c.id = m.customer_id
          where lower(u.email) = $1 and u.status = 'active' and m.customer_id = any($2::uuid[]) order by c.name`,
        [x.from_address, managed],
      );
      items.push({
        id: x.id as string,
        fromAddress: x.from_address as string,
        fromName: (x.from_name as string) ?? null,
        subject: (x.subject as string) ?? null,
        receivedAt: new Date(x.received_at as string).toISOString(),
        reason: (x.reason as string) ?? null,
        bodyText: (x.body_text as string) ?? null,
        attachmentCount: Number(x.attachment_count),
        suggestions: s.rows.map((y) => ({ userId: y.id, name: y.display_name, customerId: y.customer_id, customerName: y.name })),
      });
    }
    return items;
  });
}

export const convertSchema = z.object({
  customerId: z.uuid(),
  requesterUserId: z.uuid(),
  title: z.string().trim().min(3).max(200),
  priority: z.enum(PRIORITIES),
  category: z.enum(CATEGORIES),
});

/** Turns a reviewed email into a ticket for a requester the manager chose. */
export async function convertInbound(p: Principal, id: string, raw: unknown) {
  requireReviewer(p);
  const input = convertSchema.parse(raw);
  if (!isStaffFor(p, input.customerId)) throw forbidden("You aren't assigned to that customer.");
  const row = await asSystem(async (tx) => (await tx.query<Record<string, unknown>>("select * from inbound_emails where id = $1", [id])).rows[0]);
  if (!row || row.status !== "needs_review") throw notFound("Email");
  const requester = await asSystem((tx) => loadPrincipal(tx, input.requesterUserId));
  if (!requester || !requester.memberships.some((m) => m.customerId === input.customerId)) {
    throw new AppError(422, "validation_failed", "That person isn't a member of the customer.", { field: "requesterUserId" });
  }
  const description = ((row.body_text as string) || "(The email had no text.)").slice(0, 20000);
  const ticket = await createTicket(
    requester,
    { title: input.title, description, priority: input.priority, category: input.category, customerId: input.customerId },
    `inbound-${id}`,
    { source: "email" },
  );
  let rejected: string[] = [];
  if (Number(row.attachment_count) > 0 && emailIntakeEnabled()) {
    rejected = await attachFromEmail(requester, row.provider_email_id as string, ticket.id, null).catch(() => ["attachments could not be fetched"]);
  }
  await asSystem(async (tx) => {
    await tx.query("update inbound_emails set status = 'converted', ticket_id = $2, user_id = $3, reviewed_by = $4, reviewed_at = now() where id = $1", [
      id,
      ticket.id,
      requester.userId,
      p.userId,
    ]);
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'inbound.convert', 'ticket', $3, $4)",
      [p.userId, input.customerId, ticket.id, JSON.stringify({ inboundId: id, requester: requester.userId, rejectedFiles: rejected.length })],
    );
  });
  return { ticketId: ticket.id, number: ticket.number, rejectedFiles: rejected };
}

export async function discardInbound(p: Principal, id: string) {
  requireReviewer(p);
  const r = await asSystem((tx) =>
    tx.query("update inbound_emails set status = 'discarded', reviewed_by = $2, reviewed_at = now() where id = $1 and status = 'needs_review'", [id, p.userId]),
  );
  if (!r.rowCount) throw notFound("Email");
  await asSystem((tx) =>
    tx.query("insert into audit_events (actor_user_id, action, target_type, target_id) values ($1, 'inbound.discard', 'inbound_email', $2)", [p.userId, id]),
  );
  return { ok: true };
}
