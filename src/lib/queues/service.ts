import { z } from "zod";
import { asSystem, withUser, type Queryable } from "../db";
import { customersWhere, isStaffAnywhere, requireOperator, STAFF_ROLES, type Principal } from "../authz";
import { AppError, forbidden, notFound } from "../errors";
import { staffActiveTickets, updateTicket, type TicketSummary } from "../tickets/service";
import type { Priority } from "../tickets/schemas";

/** "none" is the bucket of active requests nobody has put in a queue yet. */
export type QueueKey = string | "none" | "all";

export interface QueueCount {
  id: string | null;
  name: string;
  active: number;
  unassigned: number;
  mine: number;
  breached: number;
  atRisk: number;
}

export type QueueTicket = TicketSummary & { queueId: string | null; assigneeUserId: string | null };

export interface QueueBoard {
  /** The queue shown: the one asked for, or "all" when it doesn't exist. */
  queue: QueueKey;
  queues: QueueCount[];
  /** Requests in no queue. */
  none: QueueCount;
  items: QueueTicket[];
  /** Technicians the viewer may assign to, with the customers each supports. */
  staff: { id: string; name: string; customerIds: string[] }[];
}

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const SLA_RANK = { breached: 0, at_risk: 1 } as const;

/** Work order: SLA breaches, then at-risk, then priority, then oldest first. */
export function byUrgency(a: QueueTicket, b: QueueTicket) {
  return (
    (a.sla ? SLA_RANK[a.sla] : 2) - (b.sla ? SLA_RANK[b.sla] : 2) ||
    PRIORITY_RANK[a.priority as Priority] - PRIORITY_RANK[b.priority as Priority] ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

function count(id: string | null, name: string, list: QueueTicket[], userId: string): QueueCount {
  return {
    id,
    name,
    active: list.length,
    unassigned: list.filter((t) => !t.assigneeUserId).length,
    mine: list.filter((t) => t.assigneeUserId === userId).length,
    breached: list.filter((t) => t.sla === "breached").length,
    atRisk: list.filter((t) => t.sla === "at_risk").length,
  };
}

export async function queueBoard(p: Principal, opts: { queue?: QueueKey; assigned?: "me" | "unassigned" } = {}): Promise<QueueBoard> {
  if (!isStaffAnywhere(p)) throw forbidden("Only technicians can see the queues.");
  const staffFor = customersWhere(p, (r) => STAFF_ROLES.includes(r));
  const [tickets, extra] = await Promise.all([
    staffActiveTickets(p),
    withUser(p.userId, async (tx) => {
      const queues = await tx.query<{ id: string; name: string }>("select id, name from queues order by name");
      const staff = await tx.query<{ id: string; display_name: string; customers: string[] }>(
        `select u.id, u.display_name, array_agg(m.customer_id::text) as customers
           from memberships m join users u on u.id = m.user_id
          where m.customer_id = any($1::uuid[]) and m.revoked_at is null and m.role = any($2) and u.status = 'active'
          group by u.id, u.display_name order by u.display_name`,
        [staffFor, STAFF_ROLES],
      );
      return { queues: queues.rows, staff: staff.rows };
    }),
  ]);
  // An unknown or deleted queue falls back to every queue.
  const asked = opts.queue ?? "all";
  const queue: QueueKey = asked === "none" || extra.queues.some((q) => q.id === asked) ? asked : "all";
  let items = tickets.filter((t) => queue === "all" || (queue === "none" ? !t.queueId : t.queueId === queue));
  if (opts.assigned === "me") items = items.filter((t) => t.assigneeUserId === p.userId);
  if (opts.assigned === "unassigned") items = items.filter((t) => !t.assigneeUserId);
  return {
    queue,
    queues: extra.queues.map((q) => count(q.id, q.name, tickets.filter((t) => t.queueId === q.id), p.userId)),
    none: count(null, "No queue", tickets.filter((t) => !t.queueId), p.userId),
    items: items.sort(byUrgency),
    staff: extra.staff.map((s) => ({ id: s.id, name: s.display_name, customerIds: s.customers })),
  };
}

export const bulkSchema = z
  .object({
    action: z.enum(["take", "assign", "unassign", "move"]),
    tickets: z
      .array(z.object({ id: z.uuid(), version: z.number().int().positive() }))
      .min(1, { error: "Select at least one request." })
      .max(100, { error: "Select at most 100 requests at a time." }),
    assigneeUserId: z.uuid().optional(),
    queueId: z.uuid().nullable().optional(),
  })
  .refine((v) => v.action !== "assign" || v.assigneeUserId, { error: "Choose a technician.", path: ["assigneeUserId"] })
  .refine((v) => v.action !== "move" || v.queueId !== undefined, { error: "Choose a queue.", path: ["queueId"] });

export interface BulkResult {
  updated: number;
  failed: { id: string; message: string }[];
}

/**
 * Applies one change to many tickets. Each ticket goes through updateTicket on
 * its own, so permissions, history, notifications, audit and the version check
 * all apply; one failure doesn't stop the rest.
 */
export async function bulkUpdate(p: Principal, raw: unknown): Promise<BulkResult> {
  if (!isStaffAnywhere(p)) throw forbidden("Only technicians can change the queues.");
  const v = bulkSchema.parse(raw);
  if (v.queueId) {
    const ok = await withUser(p.userId, (tx) => tx.query("select 1 from queues where id = $1", [v.queueId]));
    if (!ok.rows[0]) throw new AppError(422, "validation_failed", "That queue no longer exists.", { field: "queueId" });
  }
  const change =
    v.action === "take"
      ? { assigneeUserId: p.userId }
      : v.action === "assign"
        ? { assigneeUserId: v.assigneeUserId! }
        : v.action === "unassign"
          ? { assigneeUserId: null }
          : { queueId: v.queueId ?? null };
  const result: BulkResult = { updated: 0, failed: [] };
  for (const t of v.tickets) {
    try {
      await updateTicket(p, t.id, { expectedVersion: t.version, ...change });
      result.updated++;
    } catch (err) {
      const message = err instanceof AppError ? err.message : "Couldn't update this request.";
      result.failed.push({ id: t.id, message });
    }
  }
  return result;
}

// ---------------------------------------------------------------- operator admin

export interface QueueAdminRow {
  id: string;
  name: string;
  activeTickets: number;
  totalTickets: number;
  rules: number;
}

const nameSchema = z.object({
  name: z
    .string()
    .transform((s) => s.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(2, { error: "Name the queue (at least 2 characters)." }).max(60, { error: "Keep the name under 60 characters." })),
});

export async function listQueuesAdmin(p: Principal): Promise<QueueAdminRow[]> {
  requireOperator(p);
  return asSystem(async (tx) => {
    const r = await tx.query<{ id: string; name: string; active: string; total: string; rules: string }>(
      `select q.id, q.name,
              (select count(*) from tickets t where t.queue_id = q.id and t.status not in ('resolved', 'closed'))::text as active,
              (select count(*) from tickets t where t.queue_id = q.id)::text as total,
              (select count(*) from assignment_rules a where a.assign_queue_id = q.id)::text as rules
         from queues q order by q.name`,
    );
    return r.rows.map((x) => ({ id: x.id, name: x.name, activeTickets: Number(x.active), totalTickets: Number(x.total), rules: Number(x.rules) }));
  });
}

const auditQueue = (tx: Queryable, p: Principal, action: string, id: string, details: object) =>
  tx.query(
    "insert into audit_events (actor_user_id, action, target_type, target_id, details) values ($1, $2, 'queue', $3, $4)",
    [p.userId, action, id, JSON.stringify(details)],
  );

export async function saveQueue(p: Principal, id: string | null, raw: unknown) {
  requireOperator(p);
  const { name } = nameSchema.parse(raw);
  const duplicate = () => new AppError(409, "validation_failed", "A queue with that name already exists.", { field: "name" });
  try {
    return await asSystem(async (tx) => {
      // Names are unique regardless of case; the constraint backs this up under a race.
      const taken = await tx.query("select 1 from queues where lower(name) = lower($1) and id is distinct from $2", [name, id]);
      if (taken.rows[0]) throw duplicate();
      const r = id
        ? await tx.query<{ id: string }>("update queues set name = $2 where id = $1 returning id", [id, name])
        : await tx.query<{ id: string }>("insert into queues (name) values ($1) returning id", [name]);
      if (!r.rows[0]) throw notFound("Queue");
      await auditQueue(tx, p, id ? "queue.rename" : "queue.create", r.rows[0].id, { name });
      return { id: r.rows[0].id };
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw duplicate();
    throw err;
  }
}

const deleteSchema = z.object({ moveTo: z.uuid().nullable() });

/**
 * Deletes a queue. Its requests (open and closed) move to `moveTo` or to no
 * queue, and so do the assignment rules that route to it. A rule that only
 * routes to this queue needs somewhere to go, so "no queue" is refused then.
 */
export async function deleteQueue(p: Principal, id: string, raw: unknown) {
  requireOperator(p);
  const { moveTo } = deleteSchema.parse(raw);
  if (moveTo === id) throw new AppError(422, "validation_failed", "Choose a different queue to move its requests to.", { field: "moveTo" });
  return asSystem(async (tx) => {
    const q = await tx.query<{ name: string }>("select name from queues where id = $1 for update", [id]);
    if (!q.rows[0]) throw notFound("Queue");
    if (moveTo) {
      const target = await tx.query("select 1 from queues where id = $1", [moveTo]);
      if (!target.rows[0]) throw new AppError(422, "validation_failed", "The queue to move requests to no longer exists.", { field: "moveTo" });
    } else {
      const stranded = await tx.query<{ name: string }>(
        "select name from assignment_rules where assign_queue_id = $1 and assign_user_id is null order by name",
        [id],
      );
      if (stranded.rows.length) {
        throw new AppError(
          422,
          "validation_failed",
          `These assignment rules only send requests to this queue: ${stranded.rows.map((r) => r.name).join(", ")}. Move them to another queue, or change the rules first.`,
          { field: "moveTo" },
        );
      }
    }
    // Bump versions so anyone with a moved ticket open reloads before saving over it.
    const moved = await tx.query("update tickets set queue_id = $2, version = version + 1 where queue_id = $1", [id, moveTo]);
    await tx.query("update assignment_rules set assign_queue_id = $2, updated_at = now() where assign_queue_id = $1", [id, moveTo]);
    await tx.query("delete from queues where id = $1", [id]);
    await auditQueue(tx, p, "queue.delete", id, { name: q.rows[0].name, movedTo: moveTo, ticketsMoved: moved.rowCount });
    return { ok: true, ticketsMoved: moved.rowCount };
  });
}
