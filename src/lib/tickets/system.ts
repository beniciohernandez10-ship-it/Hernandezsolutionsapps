import type { Queryable } from "../db";
import { enqueue } from "../jobs-queue";
import { applySlaOnCreate } from "../sla/service";
import type { Category, Priority } from "./schemas";

/**
 * Tickets the server opens on its own (monitoring, recurring maintenance),
 * from a system account. Runs in system context: the database allows a system
 * account as requester only there (tickets_guard, 0021). SLA, assignment
 * rules and the "new request" notification apply as for any ticket.
 */

export const SYSTEM_USERS = {
  monitoring: "00000000-0000-4000-8000-0000000a1e47",
  scheduler: "00000000-0000-4000-8000-00000005c4ed",
} as const;

export interface SystemTicket {
  customerId: string;
  requesterId: string;
  source: "monitoring" | "scheduled";
  /** Monitoring reports problems (incident); scheduled maintenance is a service request. */
  kind: "incident" | "request";
  title: string;
  description: string;
  priority: Priority;
  category: Category;
  assigneeUserId?: string | null;
  queueId?: string | null;
  deviceId?: string | null;
  /** Checklist items, created as the ticket's tasks. */
  tasks?: string[];
}

export async function createSystemTicket(tx: Queryable, t: SystemTicket) {
  // Tickets need a title of at least 3 characters; some sources send very short ones.
  const title = (t.title.trim().length >= 3 ? t.title.trim() : `Alert: ${t.title.trim()}`).slice(0, 200);
  // Only someone who still supports the client can be assigned.
  let assignee: string | null = null;
  if (t.assigneeUserId) {
    const ok = await tx.query(
      "select 1 from memberships where user_id = $1 and customer_id = $2 and revoked_at is null and role in ('technician', 'service_manager')",
      [t.assigneeUserId, t.customerId],
    );
    assignee = ok.rows[0] ? t.assigneeUserId : null;
  }
  const r = await tx.query<{ id: string; number: string }>(
    `insert into tickets (customer_id, requester_user_id, title, description, priority, category, source, kind, assignee_user_id, queue_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id, number`,
    [t.customerId, t.requesterId, title, t.description.slice(0, 20000), t.priority, t.category, t.source, t.kind, assignee, t.queueId ?? null],
  );
  const id = r.rows[0].id;
  await tx.query("insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, to_value) values ($1, $2, null, 'created', 'open')", [id, t.customerId]);
  if (assignee) {
    await tx.query("insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, to_value) values ($1, $2, null, 'assigned', $3)", [id, t.customerId, assignee]);
  }
  if (t.deviceId) {
    await tx.query("insert into ticket_devices (ticket_id, device_id, customer_id) values ($1, $2, $3) on conflict do nothing", [id, t.deviceId, t.customerId]);
  }
  for (const [i, title] of (t.tasks ?? []).entries()) {
    await tx.query("insert into ticket_tasks (ticket_id, customer_id, title, position) values ($1, $2, $3, $4)", [id, t.customerId, title.slice(0, 200), i]);
  }
  await applySlaOnCreate(tx, id);
  await tx.query("select app_apply_assignment_rules($1)", [id]);
  await enqueue(tx, "notify.ticket", t.customerId, { ticketId: id, event: "created", actorUserId: null, detail: null, ref: null });
  if (assignee) await enqueue(tx, "notify.ticket", t.customerId, { ticketId: id, event: "assigned", actorUserId: null, detail: null, ref: assignee });
  return { id, number: Number(r.rows[0].number) };
}
