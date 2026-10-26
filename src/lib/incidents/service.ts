import { z } from "zod";
import { asSystem, withUser, type Queryable } from "../db";
import { isStaffFor, type Principal } from "../authz";
import { AppError, forbidden, notFound } from "../errors";
import { emailSendingEnabled } from "../config";
import { enqueue } from "../jobs-queue";
import { emitTicketEvent } from "../notify/service";
import { applySlaTransition } from "../sla/service";
import type { Status } from "../tickets/schemas";

/**
 * Major incidents. A service manager declares one for some or all customers,
 * links the requests it caused, and posts updates. Each update is added to
 * every linked request (so their requesters hear about it the usual way) and
 * client administrators of affected customers get a notification. Everyone at
 * an affected customer sees it on the status page.
 */

export const INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  investigating: "Investigating",
  identified: "Cause identified",
  monitoring: "Fix applied, monitoring",
  resolved: "Resolved",
};
export const SEVERITY_LABEL = { minor: "Minor", major: "Major", critical: "Critical" } as const;

export interface IncidentSummary {
  id: string;
  number: number;
  title: string;
  severity: keyof typeof SEVERITY_LABEL;
  status: IncidentStatus;
  allCustomers: boolean;
  startedAt: string;
  resolvedAt: string | null;
  latest: { body: string; status: IncidentStatus; createdAt: string } | null;
}

export interface IncidentDetail extends IncidentSummary {
  customers: { id: string; name: string }[];
  updates: { status: IncidentStatus; body: string; authorName: string | null; createdAt: string }[];
  tickets: { id: string; number: number; title: string; status: Status; customerName: string }[];
  canManage: boolean;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const isManager = (p: Principal) => p.memberships.some((m) => m.role === "service_manager");

async function summaries(tx: Queryable, where: string, params: unknown[]): Promise<IncidentSummary[]> {
  const r = await tx.query(
    `select i.*, u.body as latest_body, u.status as latest_status, u.created_at as latest_at
       from service_incidents i
       left join lateral (select body, status, created_at from service_incident_updates x where x.incident_id = i.id order by created_at desc limit 1) u on true
      where ${where} order by i.started_at desc limit 50`,
    params,
  );
  return r.rows.map((x) => ({
    id: x.id as string,
    number: Number(x.number),
    title: x.title as string,
    severity: x.severity as IncidentSummary["severity"],
    status: x.status as IncidentStatus,
    allCustomers: Boolean(x.all_customers),
    startedAt: iso(x.started_at)!,
    resolvedAt: iso(x.resolved_at),
    latest: x.latest_body ? { body: x.latest_body as string, status: x.latest_status as IncidentStatus, createdAt: iso(x.latest_at)! } : null,
  }));
}

/** Active incidents and those resolved in the last 7 days that affect the viewer (managers: all). */
export async function listIncidents(p: Principal) {
  if (!p.memberships.length) return { active: [], recent: [] };
  return withUser(p.userId, async (tx) => ({
    active: await summaries(tx, "i.status <> 'resolved'", []),
    recent: await summaries(tx, "i.status = 'resolved' and i.resolved_at > now() - interval '7 days'", []),
  }));
}

/** Active incidents for the portal banner (affecting the viewer's own customers). */
export async function activeIncidentsFor(p: Principal) {
  if (!p.memberships.length) return [];
  return withUser(p.userId, async (tx) =>
    (
      await tx.query<{ id: string; number: string; title: string; severity: string }>(
        `select id, number, title, severity from service_incidents i where i.status <> 'resolved' and app_incident_visible(i.id) order by started_at desc limit 3`,
      )
    ).rows.map((r) => ({ id: r.id, number: Number(r.number), title: r.title, severity: r.severity })),
  );
}

export interface Maintenance {
  id: string;
  number: number;
  customerId: string;
  title: string;
  impact: string;
  status: string;
  plannedStart: string | null;
  plannedEnd: string | null;
}

export async function upcomingMaintenance(p: Principal): Promise<Maintenance[]> {
  if (!p.memberships.length) return [];
  return withUser(p.userId, async (tx) =>
    (await tx.query<Record<string, unknown>>("select * from app_upcoming_maintenance()")).rows.map((r) => ({
      id: r.id as string,
      number: Number(r.number),
      customerId: r.customer_id as string,
      title: r.title as string,
      impact: r.impact as string,
      status: r.status as string,
      plannedStart: iso(r.planned_start),
      plannedEnd: iso(r.planned_end),
    })),
  );
}

export async function getIncident(p: Principal, id: string): Promise<IncidentDetail> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Incident");
  return withUser(p.userId, async (tx) => {
    const [s] = await summaries(tx, "i.id = $1", [id]);
    if (!s) throw notFound("Incident");
    const customers = await tx.query<{ id: string; name: string }>(
      "select c.id, c.name from service_incident_customers ic join customers c on c.id = ic.customer_id where ic.incident_id = $1 order by c.name",
      [id],
    );
    const updates = await tx.query(
      `select x.status, x.body, x.created_at, u.display_name from service_incident_updates x left join users u on u.id = x.created_by
        where x.incident_id = $1 order by x.created_at desc`,
      [id],
    );
    const tickets = await tx.query<{ id: string; number: string; title: string; status: Status; name: string }>(
      `select t.id, t.number, t.title, t.status, c.name from tickets t join customers c on c.id = t.customer_id
        where t.major_incident_id = $1 order by t.number`,
      [id],
    );
    return {
      ...s,
      customers: customers.rows,
      updates: updates.rows.map((u) => ({ status: u.status as IncidentStatus, body: u.body as string, authorName: (u.display_name as string) ?? null, createdAt: iso(u.created_at)! })),
      tickets: tickets.rows.map((t) => ({ id: t.id, number: Number(t.number), title: t.title, status: t.status, customerName: t.name })),
      canManage: isManager(p),
    };
  });
}

export const declareSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    severity: z.enum(["minor", "major", "critical"]),
    allCustomers: z.boolean(),
    customerIds: z.array(z.uuid()).max(500).default([]),
    message: z
      .string()
      .transform((s) => s.replace(/\r\n/g, "\n").trim())
      .pipe(z.string().min(1, { error: "Say what's happening." }).max(5000)),
  })
  .refine((v) => v.allCustomers || v.customerIds.length > 0, { error: "Choose the affected clients.", path: ["customerIds"] });

export async function declareIncident(p: Principal, raw: unknown) {
  if (!isManager(p)) throw forbidden("Only service managers can declare incidents.");
  const v = declareSchema.parse(raw);
  for (const c of v.customerIds) if (!isStaffFor(p, c)) throw forbidden("You can only declare incidents for clients you're assigned to.");
  const r = await withUser(p.userId, async (tx) => {
    const i = await tx.query<{ id: string; number: string }>(
      "insert into service_incidents (title, severity, all_customers, created_by) values ($1, $2, $3, $4) returning id, number",
      [v.title, v.severity, v.allCustomers, p.userId],
    );
    const id = i.rows[0].id;
    if (!v.allCustomers) for (const c of v.customerIds) await tx.query("insert into service_incident_customers (incident_id, customer_id) values ($1, $2)", [id, c]);
    await tx.query("insert into service_incident_updates (incident_id, status, body, created_by) values ($1, 'investigating', $2, $3)", [id, v.message, p.userId]);
    await tx.query("insert into audit_events (actor_user_id, action, target_type, target_id, details) values ($1, 'incident.declare', 'service_incident', $2, $3)", [
      p.userId,
      id,
      JSON.stringify({ severity: v.severity, allCustomers: v.allCustomers, customers: v.customerIds.length }),
    ]);
    return { id, number: Number(i.rows[0].number) };
  });
  await notifyAdmins(r.id, p.userId, "investigating");
  return r;
}

export const updateSchema = z.object({
  status: z.enum(INCIDENT_STATUSES),
  body: z
    .string()
    .transform((s) => s.replace(/\r\n/g, "\n").trim())
    .pipe(z.string().min(1).max(5000)),
  /** When resolving: also resolve the linked requests with this update as the resolution. */
  resolveTickets: z.boolean().default(false),
});

export async function postIncidentUpdate(p: Principal, id: string, raw: unknown) {
  if (!isManager(p)) throw forbidden("Only service managers can update incidents.");
  const v = updateSchema.parse(raw);
  await withUser(p.userId, async (tx) => {
    const cur = await tx.query<{ number: string; status: string }>("select number, status from service_incidents where id = $1", [id]);
    if (!cur.rows[0]) throw notFound("Incident");
    if (cur.rows[0].status === "resolved") throw new AppError(409, "invalid_transition", "This incident is already resolved.");
    const number = Number(cur.rows[0].number);
    await tx.query("insert into service_incident_updates (incident_id, status, body, created_by) values ($1, $2, $3, $4)", [id, v.status, v.body, p.userId]);
    await tx.query(
      `update service_incidents set status = $2, updated_at = now() ${v.status === "resolved" ? ", resolved_at = now()" : ""} where id = $1`,
      [id, v.status],
    );
    // Post the update to every linked request this manager serves; requesters are notified as for any reply.
    const linked = await tx.query<{ id: string; customer_id: string; status: Status }>("select id, customer_id, status from tickets where major_incident_id = $1", [id]);
    for (const t of linked.rows) {
      if (!isStaffFor(p, t.customer_id) || t.status === "closed") continue;
      await tx.query("insert into ticket_messages (ticket_id, customer_id, author_user_id, visibility, body) values ($1, $2, $3, 'public', $4)", [
        t.id,
        t.customer_id,
        p.userId,
        `Update on a wider issue (INC-${number}, ${INCIDENT_STATUS_LABEL[v.status].toLowerCase()}): ${v.body}`.slice(0, 20000),
      ]);
      const resolveNow = v.status === "resolved" && v.resolveTickets && t.status !== "resolved";
      await tx.query(
        `update tickets set updated_at = now(), version = version + 1, first_response_at = coalesce(first_response_at, now())
           ${resolveNow ? ", status = 'resolved', resolved_at = now(), resolution_note = $2" : ""} where id = $1`,
        resolveNow ? [t.id, `Resolved with service incident INC-${number}: ${v.body}`.slice(0, 5000)] : [t.id],
      );
      if (resolveNow) {
        await applySlaTransition(tx, t.id, { fromStatus: t.status, toStatus: "resolved" });
        await tx.query("insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, from_value, to_value) values ($1, $2, $3, 'status_changed', $4, 'resolved')", [
          t.id,
          t.customer_id,
          p.userId,
          t.status,
        ]);
        await emitTicketEvent(tx, t.id, "status_changed", "resolved");
      } else {
        await emitTicketEvent(tx, t.id, "public_reply");
      }
    }
    await tx.query("insert into audit_events (actor_user_id, action, target_type, target_id, details) values ($1, 'incident.update', 'service_incident', $2, $3)", [
      p.userId,
      id,
      JSON.stringify({ status: v.status, resolveTickets: v.resolveTickets }),
    ]);
  });
  await notifyAdmins(id, p.userId, v.status);
  return { ok: true };
}

/** In-app (and email) notice to client administrators of affected customers. */
async function notifyAdmins(incidentId: string, actorUserId: string, status: string) {
  await asSystem(async (tx) => {
    const r = await tx.query<{ user_id: string; customer_id: string; email: string; is_demo: boolean; email_enabled: boolean | null; email_ticket_updates: boolean | null }>(
      `select distinct on (m.user_id) m.user_id, m.customer_id, u.email, u.is_demo, p.email_enabled, p.email_ticket_updates
         from service_incidents i
         join memberships m on m.revoked_at is null and m.role = 'client_admin'
              and (i.all_customers or exists (select 1 from service_incident_customers ic where ic.incident_id = i.id and ic.customer_id = m.customer_id))
         join users u on u.id = m.user_id and u.status = 'active'
         left join notification_preferences p on p.user_id = u.id
        where i.id = $1 and m.user_id <> $2`,
      [incidentId, actorUserId],
    );
    for (const a of r.rows) {
      const n = await tx.query<{ id: string }>(
        "insert into notifications (user_id, customer_id, incident_id, kind, actor_user_id, detail) values ($1, $2, $3, 'incident_update', $4, $5) returning id",
        [a.user_id, a.customer_id, incidentId, actorUserId, status],
      );
      const wants = !a.is_demo && a.email_enabled !== false && a.email_ticket_updates !== false;
      if (wants && emailSendingEnabled()) await enqueue(tx, "email.notification", a.customer_id, { notificationId: n.rows[0].id, category: "email_ticket_updates" }, `email:${n.rows[0].id}`);
    }
  });
}

const linkSchema = z.object({ ticketId: z.uuid(), remove: z.boolean().default(false) });

/** Links a request to an incident affecting its customer (technicians of that customer). */
export async function linkIncidentTicket(p: Principal, incidentId: string, raw: unknown) {
  const { ticketId, remove } = linkSchema.parse(raw);
  return withUser(p.userId, async (tx) => {
    const t = await tx.query<{ customer_id: string }>("select customer_id from tickets where id = $1", [ticketId]);
    const c = t.rows[0]?.customer_id;
    if (!c || !p.memberships.some((m) => m.customerId === c)) throw notFound("Ticket");
    if (!isStaffFor(p, c)) throw forbidden("Only technicians can link requests to incidents.");
    const i = await tx.query("select 1 from service_incidents where id = $1 and status <> 'resolved' and app_incident_visible(id)", [incidentId]);
    if (!remove && !i.rows[0]) throw new AppError(422, "validation_failed", "That incident isn't active for this client.", { field: "incidentId" });
    await tx.query(`update tickets set major_incident_id = $2, updated_at = now(), version = version + 1 where id = $1`, [ticketId, remove ? null : incidentId]);
    await tx.query("insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, to_value) values ($1, $2, $3, $4, $5)", [
      ticketId,
      c,
      p.userId,
      remove ? "incident_unlinked" : "incident_linked",
      null,
    ]);
    return { ok: true };
  });
}

/** Active incidents that affect one customer (for linking a request). */
export async function incidentsForCustomer(p: Principal, customerId: string) {
  if (!isStaffFor(p, customerId)) return [];
  return withUser(p.userId, async (tx) =>
    (
      await tx.query<{ id: string; number: string; title: string }>(
        `select i.id, i.number, i.title from service_incidents i
          where i.status <> 'resolved' and (i.all_customers or exists (select 1 from service_incident_customers ic where ic.incident_id = i.id and ic.customer_id = $1))
          order by i.started_at desc`,
        [customerId],
      )
    ).rows.map((r) => ({ id: r.id, number: Number(r.number), title: r.title })),
  );
}
