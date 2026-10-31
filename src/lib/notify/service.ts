import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { asSystem, withUser, type Queryable } from "../db";
import type { Principal } from "../authz";
import { config, emailIntakeEnabled, emailSendingEnabled } from "../config";
import { enqueue } from "../jobs-queue";
import { sendEmail } from "../email/resend";
import { renderNotificationEmail, type NotificationKind } from "../email/templates";
import type { SweepEvent } from "../sla/service";
import { CATEGORY_LABEL, categoryForKind, EMAIL_CATEGORIES, issueUnsubscribeToken, type EmailCategory } from "./unsubscribe";

/**
 * Notifications. Business changes call emitTicketEvent() inside their own
 * transaction; that enqueues one notify.ticket job (transactional outbox).
 * The job decides who should hear about it, writes in-app notifications and
 * enqueues one email per recipient whose preferences allow it.
 */

export type TicketEvent =
  | "created"
  | "public_reply"
  | "internal_note"
  | "status_changed"
  | "assigned"
  | "attachment_added"
  | "approval_requested"
  | "approval_decided";

/** Called in the user's transaction (itc_app). The database function re-checks visibility and role. */
export async function emitTicketEvent(tx: Queryable, ticketId: string, event: TicketEvent, detail: string | null = null, ref: string | null = null) {
  await tx.query("select app_enqueue_ticket_event($1, $2, $3, $4)", [ticketId, event, detail, ref]);
}

type PrefKey = EmailCategory;

interface Recipient {
  userId: string;
  kind: NotificationKind;
  pref: PrefKey;
}

interface TicketContext {
  id: string;
  customerId: string;
  requesterId: string;
  assigneeId: string | null;
  /** Active staff (technician / service manager) for the customer. */
  staff: { userId: string; role: string }[];
  /** Active client administrators of the customer. */
  clientAdmins: string[];
  /** Named approvers who are still active members (see 0019). */
  approvers: string[];
  requesterActive: boolean;
}

async function ticketContext(tx: Queryable, ticketId: string): Promise<TicketContext | null> {
  const t = await tx.query<{ id: string; customer_id: string; requester_user_id: string; assignee_user_id: string | null }>(
    "select id, customer_id, requester_user_id, assignee_user_id from tickets where id = $1",
    [ticketId],
  );
  if (!t.rows[0]) return null;
  const members = await tx.query<{ user_id: string; role: string }>(
    `select m.user_id, m.role from memberships m join users u on u.id = m.user_id join customers c on c.id = m.customer_id
      where m.customer_id = $1 and m.revoked_at is null and u.status = 'active' and c.status <> 'offboarded'`,
    [t.rows[0].customer_id],
  );
  const staff = members.rows.filter((m) => m.role === "technician" || m.role === "service_manager").map((m) => ({ userId: m.user_id, role: m.role }));
  const named = await tx.query<{ user_id: string }>("select user_id from customer_approvers where customer_id = $1", [t.rows[0].customer_id]);
  const active = new Set(members.rows.map((m) => m.user_id));
  return {
    id: t.rows[0].id,
    customerId: t.rows[0].customer_id,
    requesterId: t.rows[0].requester_user_id,
    assigneeId: t.rows[0].assignee_user_id,
    staff,
    clientAdmins: members.rows.filter((m) => m.role === "client_admin").map((m) => m.user_id),
    approvers: named.rows.map((r) => r.user_id).filter((u) => active.has(u)),
    requesterActive: members.rows.some((m) => m.user_id === t.rows[0].requester_user_id),
  };
}

/** Staff to tell about something on a ticket: the assignee if there is one, otherwise everyone assigned to the customer. */
function staffAudience(c: TicketContext) {
  if (c.assigneeId && c.staff.some((s) => s.userId === c.assigneeId)) return [c.assigneeId];
  return c.staff.map((s) => s.userId);
}

export function recipientsFor(
  c: TicketContext,
  event: TicketEvent | "sla_warning" | "sla_breached",
  actorUserId: string | null,
  detail: string | null,
  ref: string | null,
): Recipient[] {
  const actorIsStaff = !!actorUserId && c.staff.some((s) => s.userId === actorUserId);
  const requester = c.requesterActive ? [c.requesterId] : [];
  const list: Recipient[] = [];
  const add = (ids: string[], kind: NotificationKind, pref: PrefKey) => ids.forEach((userId) => list.push({ userId, kind, pref }));
  switch (event) {
    case "created":
      add(staffAudience(c), "ticket_created", "email_new_tickets");
      break;
    case "public_reply":
      if (actorIsStaff) add(requester, "public_reply", "email_ticket_updates");
      else add(staffAudience(c), "public_reply", "email_ticket_updates");
      break;
    case "internal_note":
      add(staffAudience(c), "internal_note", "email_ticket_updates");
      break;
    case "status_changed":
      if (actorIsStaff) add(requester, "status_changed", "email_ticket_updates");
      else add(staffAudience(c), "status_changed", "email_ticket_updates");
      break;
    case "assigned":
      if (ref && c.staff.some((s) => s.userId === ref)) add([ref], "assigned", "email_assignments");
      break;
    case "attachment_added":
      if (detail === "internal") add(staffAudience(c), "attachment_added", "email_ticket_updates");
      else if (actorIsStaff) add(requester, "attachment_added", "email_ticket_updates");
      else add(staffAudience(c), "attachment_added", "email_ticket_updates");
      break;
    case "approval_requested": {
      const managers = c.staff.filter((s) => s.role === "service_manager").map((s) => s.userId);
      add(c.approvers.length ? c.approvers : c.clientAdmins.length ? c.clientAdmins : managers, "approval_requested", "email_ticket_updates");
      break;
    }
    case "approval_decided":
      add(requester, "approval_decided", "email_ticket_updates");
      if (detail === "approved") add(staffAudience(c), "approval_decided", "email_new_tickets");
      break;
    case "sla_warning":
    case "sla_breached": {
      const managers = c.staff.filter((s) => s.role === "service_manager").map((s) => s.userId);
      const assignee = c.assigneeId && c.staff.some((s) => s.userId === c.assigneeId) ? [c.assigneeId] : [];
      // Nobody assigned yet: tell every technician for the customer, not only managers.
      add(assignee.length ? [...assignee, ...managers] : c.staff.map((s) => s.userId), event, "email_sla");
      break;
    }
  }
  // Never notify the person who acted, and each person once.
  const seen = new Set<string>();
  return list.filter((r) => r.userId !== actorUserId && !seen.has(r.userId) && seen.add(r.userId));
}

async function deliver(tx: Queryable, c: TicketContext, recipients: Recipient[], actorUserId: string | null, detail: string | null) {
  if (recipients.length === 0) return 0;
  const prefs = await tx.query<Record<string, unknown>>(
    `select u.id, u.email, u.is_demo, u.is_system, p.email_enabled, p.email_ticket_updates, p.email_new_tickets, p.email_assignments, p.email_sla
       from users u left join notification_preferences p on p.user_id = u.id where u.id = any($1::uuid[])`,
    [recipients.map((r) => r.userId)],
  );
  const byId = new Map(prefs.rows.map((r) => [r.id as string, r]));
  for (const r of recipients) {
    const n = await tx.query<{ id: string }>(
      `insert into notifications (user_id, customer_id, ticket_id, kind, actor_user_id, detail) values ($1, $2, $3, $4, $5, $6) returning id`,
      [r.userId, c.customerId, c.id, r.kind, actorUserId, detail],
    );
    const u = byId.get(r.userId);
    // Missing preference row = defaults (all on). Demo users have example.com addresses and are never emailed.
    const wants = u && !u.is_demo && !u.is_system && u.email_enabled !== false && u[r.pref] !== false && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(u.email));
    if (wants && emailSendingEnabled()) await enqueue(tx, "email.notification", c.customerId, { notificationId: n.rows[0].id, category: r.pref }, `email:${n.rows[0].id}`);
  }
  return recipients.length;
}

const payloadSchema = z.object({
  ticketId: z.uuid(),
  event: z.enum(["created", "public_reply", "internal_note", "status_changed", "assigned", "attachment_added", "approval_requested", "approval_decided"]),
  actorUserId: z.uuid().nullable(),
  detail: z.string().max(40).nullable().optional(),
  ref: z.uuid().nullable().optional(),
});

/** Job handler for notify.ticket. */
export async function fanOutTicketEvent(payload: unknown) {
  const p = payloadSchema.parse(payload);
  return asSystem(async (tx) => {
    const c = await ticketContext(tx, p.ticketId);
    if (!c) return 0;
    return deliver(tx, c, recipientsFor(c, p.event, p.actorUserId, p.detail ?? null, p.ref ?? null), p.actorUserId, p.detail ?? null);
  });
}

/** Notifies staff about SLA warnings and breaches found by the sweep. */
export async function notifySlaEvents(events: SweepEvent[]) {
  for (const e of events) {
    await asSystem(async (tx) => {
      const c = await ticketContext(tx, e.ticketId);
      if (c) await deliver(tx, c, recipientsFor(c, e.kind, null, e.target, null), null, e.target);
    });
  }
}

const REPLY_KINDS: NotificationKind[] = ["ticket_created", "public_reply", "status_changed", "attachment_added"];

/** Reply address for one notification. Deterministic, so a retried send carries the same address. */
function replyToken(notificationId: string) {
  const key = config().email.webhookSecret!;
  return createHmac("sha256", key).update(`reply:${notificationId}`).digest("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 26).toLowerCase();
}

export const hashReplyToken = (token: string) => createHash("sha256").update(token.toLowerCase()).digest("hex");

/** Job handler for email.notification. */
export async function sendNotificationEmail(payload: unknown) {
  const { notificationId, category } = z.object({ notificationId: z.uuid(), category: z.enum(EMAIL_CATEGORIES).optional() }).parse(payload);
  const ctx = await asSystem(async (tx) => {
    const r = await tx.query<Record<string, unknown>>(
      `select n.id, n.kind, n.detail, n.user_id, n.emailed_at, n.ticket_id, n.change_id, n.incident_id, n.customer_id, n.approval_id,
              coalesce(t.number, ch.number, si.number) as number, coalesce(t.title, ch.title, si.title) as title, c.name as customer_name,
              u.email, u.status as user_status, a.display_name as actor_name,
              coalesce(p.email_enabled, true) as email_enabled,
              exists (select 1 from memberships m where m.user_id = n.user_id and m.customer_id = n.customer_id and m.revoked_at is null) as still_member
         from notifications n left join tickets t on t.id = n.ticket_id left join change_requests ch on ch.id = n.change_id
         left join service_incidents si on si.id = n.incident_id
         join customers c on c.id = n.customer_id
         join users u on u.id = n.user_id left join users a on a.id = n.actor_user_id
         left join notification_preferences p on p.user_id = n.user_id where n.id = $1`,
      [notificationId],
    );
    const row = r.rows[0];
    if (!row || row.emailed_at || row.user_status !== "active" || !row.still_member || !row.email_enabled) return null;
    const kind = row.kind as NotificationKind;
    // Requesters may only reply to their own tickets (enforced again on intake); internal and SLA mail never accepts replies.
    // Approval requests can be answered by email too ("approve" / "reject <reason>"), tied to that one approval.
    const approvalReply = kind === "approval_requested" && Boolean(row.approval_id);
    const replyEnabled = emailIntakeEnabled() && (REPLY_KINDS.includes(kind) || approvalReply) && Boolean(row.ticket_id);
    let replyTo: string | undefined;
    if (replyEnabled) {
      const token = replyToken(notificationId);
      await tx.query(
        `insert into email_reply_tokens (token_hash, ticket_id, customer_id, user_id, expires_at, approval_id)
         values ($1, $2, $3, $4, now() + interval '120 days', $5) on conflict (token_hash) do nothing`,
        [hashReplyToken(token), row.ticket_id, row.customer_id, row.user_id, approvalReply ? row.approval_id : null],
      );
      replyTo = `t-${token}@${config().email.inboundDomain}`;
    }
    const unsubscribeCategory = category ?? categoryForKind(kind);
    const unsubscribeToken = await issueUnsubscribeToken(tx, row.user_id as string, unsubscribeCategory);
    return { row, kind, replyEnabled, replyTo, unsubscribeCategory, unsubscribeToken, approvalReply };
  });
  if (!ctx) return { skipped: true };
  const { row, kind, replyEnabled, replyTo, unsubscribeCategory, unsubscribeToken, approvalReply } = ctx;
  const origin = config().appOrigin;
  // The page asks first (for people); the header URL acts on POST (for mail apps).
  const unsubscribeUrl = `${origin}/unsubscribe/${unsubscribeToken}`;
  const oneClickUrl = `${origin}/api/unsubscribe/${unsubscribeToken}`;
  const mail = renderNotificationEmail({
    kind,
    detail: (row.detail as string) ?? null,
    actorName: (row.actor_name as string) ?? null,
    ticketNumber: Number(row.number),
    ticketTitle: row.title as string,
    customerName: row.customer_name as string,
    ticketUrl: row.change_id
      ? `${origin}/portal/changes/${row.change_id}`
      : row.incident_id
        ? `${origin}/portal/incidents/${row.incident_id}`
        : `${origin}/portal/tickets/${row.ticket_id}`,
    refLabel: row.change_id ? `Change CHG-${row.number}` : row.incident_id ? `Incident INC-${row.number}` : undefined,
    settingsUrl: `${origin}/portal/settings`,
    unsubscribeUrl,
    unsubscribeLabel: CATEGORY_LABEL[unsubscribeCategory],
    replyEnabled,
    approvalReply: replyEnabled && approvalReply,
  });
  await sendEmail({
    to: row.email as string,
    ...mail,
    replyTo,
    // RFC 8058: mail apps show their own Unsubscribe button and POST to this URL.
    headers: { "List-Unsubscribe": `<${oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    idempotencyKey: `notification-${notificationId}`,
  });
  await asSystem((tx) => tx.query("update notifications set emailed_at = now() where id = $1", [notificationId]));
  return { sent: true };
}

// ---------------------------------------------------------------- in-app

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  detail: string | null;
  actorName: string | null;
  ticketId: string | null;
  changeId: string | null;
  /** Number and title of the ticket or change. */
  ticketNumber: number;
  ticketTitle: string;
  /** "#12" or "CHG-12". */
  ref: string;
  href: string;
  createdAt: string;
  read: boolean;
}

export async function listNotifications(p: Principal, limit = 30): Promise<NotificationItem[]> {
  return withUser(p.userId, async (tx) => {
    const r = await tx.query<Record<string, unknown>>(
      `select n.id, n.kind, n.detail, n.created_at, n.read_at, n.ticket_id, n.change_id, n.incident_id,
              coalesce(t.number, c.number, si.number) as number, coalesce(t.title, c.title, si.title) as title, a.display_name as actor_name
         from notifications n left join tickets t on t.id = n.ticket_id left join change_requests c on c.id = n.change_id
         left join service_incidents si on si.id = n.incident_id
         left join users a on a.id = n.actor_user_id
        where n.user_id = $1 and (t.id is not null or c.id is not null or si.id is not null) order by n.created_at desc limit $2`,
      [p.userId, Math.min(Math.max(limit, 1), 100)],
    );
    return r.rows.map((x) => ({
      id: x.id as string,
      kind: x.kind as NotificationKind,
      detail: (x.detail as string) ?? null,
      actorName: (x.actor_name as string) ?? null,
      ticketId: (x.ticket_id as string) ?? null,
      changeId: (x.change_id as string) ?? null,
      ticketNumber: Number(x.number),
      ticketTitle: x.title as string,
      ref: x.change_id ? `CHG-${x.number}` : x.incident_id ? `INC-${x.number}` : `#${x.number}`,
      href: x.change_id ? `/portal/changes/${x.change_id}` : x.incident_id ? `/portal/incidents/${x.incident_id}` : `/portal/tickets/${x.ticket_id}`,
      createdAt: new Date(x.created_at as string).toISOString(),
      read: Boolean(x.read_at),
    }));
  });
}

export async function unreadCount(p: Principal): Promise<number> {
  return withUser(p.userId, async (tx) => {
    const r = await tx.query<{ n: string }>("select count(*)::text as n from notifications where user_id = $1 and read_at is null", [p.userId]);
    return Number(r.rows[0].n);
  });
}

/** Marks notifications read: given ids, all of one ticket's, or everything. */
export async function markRead(p: Principal, target: { ids?: string[]; ticketId?: string; changeId?: string; incidentId?: string; all?: boolean }) {
  return withUser(p.userId, async (tx) => {
    const where = ["user_id = $1", "read_at is null"];
    const params: unknown[] = [p.userId];
    if (target.ids) {
      params.push(target.ids);
      where.push(`id = any($${params.length}::uuid[])`);
    } else if (target.ticketId) {
      params.push(target.ticketId);
      where.push(`ticket_id = $${params.length}`);
    } else if (target.changeId) {
      params.push(target.changeId);
      where.push(`change_id = $${params.length}`);
    } else if (target.incidentId) {
      params.push(target.incidentId);
      where.push(`incident_id = $${params.length}`);
    } else if (!target.all) return 0;
    const r = await tx.query(`update notifications set read_at = now() where ${where.join(" and ")}`, params);
    return r.rowCount;
  });
}

export const preferencesSchema = z.object({
  emailEnabled: z.boolean(),
  emailTicketUpdates: z.boolean(),
  emailNewTickets: z.boolean(),
  emailAssignments: z.boolean(),
  emailSla: z.boolean(),
  emailReports: z.boolean().default(true),
});
export type Preferences = z.infer<typeof preferencesSchema>;

const DEFAULT_PREFS: Preferences = { emailEnabled: true, emailTicketUpdates: true, emailNewTickets: true, emailAssignments: true, emailSla: true, emailReports: true };

export async function getPreferences(p: Principal): Promise<Preferences> {
  return withUser(p.userId, async (tx) => {
    const r = await tx.query<Record<string, boolean>>("select * from notification_preferences where user_id = $1", [p.userId]);
    const x = r.rows[0];
    if (!x) return DEFAULT_PREFS;
    return {
      emailEnabled: x.email_enabled,
      emailTicketUpdates: x.email_ticket_updates,
      emailNewTickets: x.email_new_tickets,
      emailAssignments: x.email_assignments,
      emailSla: x.email_sla,
      emailReports: x.email_reports,
    };
  });
}

export async function updatePreferences(p: Principal, raw: unknown): Promise<Preferences> {
  const v = preferencesSchema.parse(raw);
  await withUser(p.userId, (tx) =>
    tx.query(
      `insert into notification_preferences (user_id, email_enabled, email_ticket_updates, email_new_tickets, email_assignments, email_sla, email_reports, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (user_id) do update set email_enabled = $2, email_ticket_updates = $3, email_new_tickets = $4,
         email_assignments = $5, email_sla = $6, email_reports = $7, updated_at = now()`,
      [p.userId, v.emailEnabled, v.emailTicketUpdates, v.emailNewTickets, v.emailAssignments, v.emailSla, v.emailReports],
    ),
  );
  return v;
}

// ---------------------------------------------------------------- changes

const changePayload = z.object({
  changeId: z.uuid(),
  event: z.enum(["change_approval_requested", "change_decided", "change_scheduled", "change_finished"]),
  actorUserId: z.uuid().nullable(),
  detail: z.string().max(40).nullable().optional(),
});

/** Job handler for notify.change. */
export async function fanOutChangeEvent(payload: unknown) {
  const p = changePayload.parse(payload);
  return asSystem(async (tx) => {
    const c = (
      await tx.query<{ id: string; customer_id: string; change_type: string; created_by: string; implementer_user_id: string | null }>(
        "select id, customer_id, change_type, created_by, implementer_user_id from change_requests where id = $1",
        [p.changeId],
      )
    ).rows[0];
    if (!c) return 0;
    const members = await tx.query<{ user_id: string; role: string }>(
      `select m.user_id, m.role from memberships m join users u on u.id = m.user_id
        where m.customer_id = $1 and m.revoked_at is null and u.status = 'active'`,
      [c.customer_id],
    );
    const role = new Map(members.rows.map((m) => [m.user_id, m.role]));
    const admins = members.rows.filter((m) => m.role === "client_admin").map((m) => m.user_id);
    const managers = members.rows.filter((m) => m.role === "service_manager").map((m) => m.user_id);
    const isStaff = (u: string | null) => !!u && (role.get(u) === "technician" || role.get(u) === "service_manager");
    const owners = [c.created_by, c.implementer_user_id].filter(isStaff) as string[];
    let ids: string[] = [];
    if (p.event === "change_approval_requested") ids = c.change_type === "emergency" || !admins.length ? managers : admins;
    if (p.event === "change_decided") ids = owners;
    if (p.event === "change_scheduled") ids = admins;
    if (p.event === "change_finished") ids = [...admins, ...owners];
    const seen = new Set<string>();
    const recipients = ids.filter((u) => u !== p.actorUserId && !seen.has(u) && seen.add(u));
    if (!recipients.length) return 0;
    const prefs = await tx.query<Record<string, unknown>>(
      `select u.id, u.email, u.is_demo, u.is_system, p.email_enabled, p.email_ticket_updates from users u
         left join notification_preferences p on p.user_id = u.id where u.id = any($1::uuid[])`,
      [recipients],
    );
    const byId = new Map(prefs.rows.map((r) => [r.id as string, r]));
    for (const userId of recipients) {
      const n = await tx.query<{ id: string }>(
        "insert into notifications (user_id, customer_id, change_id, kind, actor_user_id, detail) values ($1, $2, $3, $4, $5, $6) returning id",
        [userId, c.customer_id, c.id, p.event, p.actorUserId, p.detail ?? null],
      );
      const u = byId.get(userId);
      const wants = u && !u.is_demo && !u.is_system && u.email_enabled !== false && u.email_ticket_updates !== false && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(u.email));
      if (wants && emailSendingEnabled()) await enqueue(tx, "email.notification", c.customer_id, { notificationId: n.rows[0].id, category: "email_ticket_updates" }, `email:${n.rows[0].id}`);
    }
    return recipients.length;
  });
}
