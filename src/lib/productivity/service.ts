import { z } from "zod";
import { asSystem, withUser, type Queryable } from "../db";
import { isStaffAnywhere, isStaffFor, requireOperator, type Principal } from "../authz";
import { AppError, forbidden, notFound } from "../errors";
import { emitTicketEvent } from "../notify/service";
import { applySlaTransition } from "../sla/service";
import { CATEGORIES, PRIORITIES, type Status } from "../tickets/schemas";

export { fillPlaceholders } from "./placeholders";

/**
 * Technician productivity: saved replies, merged and parent/child tickets,
 * and assignment rules. Everything here is staff-only; customers see the
 * results (a merged notice, linked requests they can already see).
 */

// ---------------------------------------------------------------- saved replies

export interface CannedResponse {
  id: string;
  customerId: string | null;
  title: string;
  body: string;
}

export const cannedSchema = z.object({
  customerId: z.uuid().nullable(),
  title: z.string().trim().min(1).max(120),
  body: z
    .string()
    .transform((s) => s.replace(/\r\n/g, "\n").trim())
    .pipe(z.string().min(1).max(10000)),
});

const canManage = (p: Principal, customerId: string | null) => (customerId ? isStaffFor(p, customerId) : isStaffAnywhere(p));

/** Saved replies usable on a ticket of the given customer (or all the technician can see). */
export async function listCanned(p: Principal, customerId?: string): Promise<CannedResponse[]> {
  if (!isStaffAnywhere(p)) return [];
  return withUser(p.userId, async (tx) => {
    const r = await tx.query(
      `select id, customer_id, title, body from canned_responses
        where ${customerId ? "(customer_id is null or customer_id = $1)" : "true"} order by title`,
      customerId ? [customerId] : [],
    );
    return r.rows.map((x) => ({ id: x.id as string, customerId: (x.customer_id as string) ?? null, title: x.title as string, body: x.body as string }));
  });
}

export async function saveCanned(p: Principal, id: string | null, raw: unknown) {
  const v = cannedSchema.parse(raw);
  if (!canManage(p, v.customerId)) throw forbidden("Only technicians can manage saved replies.");
  return withUser(p.userId, async (tx) => {
    const r = id
      ? await tx.query<{ id: string }>("update canned_responses set customer_id = $2, title = $3, body = $4, updated_at = now() where id = $1 returning id", [
          id,
          v.customerId,
          v.title,
          v.body,
        ])
      : await tx.query<{ id: string }>("insert into canned_responses (customer_id, title, body, created_by) values ($1, $2, $3, $4) returning id", [
          v.customerId,
          v.title,
          v.body,
          p.userId,
        ]);
    if (!r.rows[0]) throw notFound("Saved reply");
    return { id: r.rows[0].id };
  });
}

export async function deleteCanned(p: Principal, id: string) {
  if (!isStaffAnywhere(p)) throw forbidden();
  const r = await withUser(p.userId, (tx) => tx.query("delete from canned_responses where id = $1", [id]));
  if (!r.rowCount) throw notFound("Saved reply");
  return { ok: true };
}

// ---------------------------------------------------------------- related tickets

async function staffTicket(tx: Queryable, p: Principal, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Ticket");
  const r = await tx.query<{ id: string; number: string; title: string; description: string; customer_id: string; status: Status; merged_into_ticket_id: string | null; requester_name: string }>(
    `select t.id, t.number, t.title, t.description, t.customer_id, t.status, t.merged_into_ticket_id, u.display_name as requester_name
       from tickets t join users u on u.id = t.requester_user_id where t.id = $1`,
    [id],
  );
  const t = r.rows[0];
  if (!t || !p.memberships.some((m) => m.customerId === t.customer_id)) throw notFound("Ticket");
  if (!isStaffFor(p, t.customer_id)) throw forbidden("Only technicians can link or merge tickets.");
  return t;
}

/** Another ticket of the same customer, by number. */
async function byNumber(tx: Queryable, customerId: string, number: number) {
  const r = await tx.query<{ id: string; number: string; title: string; status: Status; merged_into_ticket_id: string | null; parent_ticket_id: string | null }>(
    "select id, number, title, status, merged_into_ticket_id, parent_ticket_id from tickets where number = $1 and customer_id = $2",
    [number, customerId],
  );
  if (!r.rows[0]) throw new AppError(422, "validation_failed", `There's no request #${number} for this customer.`, { field: "number" });
  return r.rows[0];
}

const numberSchema = z.object({ number: z.coerce.number().int().positive() });

/**
 * Merges a duplicate into another request of the same customer: the duplicate
 * is resolved with a note pointing at the target, and its details are copied
 * to the target as a private note.
 */
export async function mergeTicket(p: Principal, sourceId: string, raw: unknown) {
  const { number } = numberSchema.parse(raw);
  return withUser(p.userId, async (tx) => {
    const src = await staffTicket(tx, p, sourceId);
    if (src.merged_into_ticket_id) throw new AppError(409, "invalid_transition", "This request was already merged.");
    if (src.status === "closed") throw new AppError(409, "invalid_transition", "Closed requests can't be merged.");
    const target = await byNumber(tx, src.customer_id, number);
    if (target.id === src.id) throw new AppError(422, "validation_failed", "Choose a different request.", { field: "number" });
    if (target.merged_into_ticket_id) throw new AppError(422, "validation_failed", `#${number} was itself merged into another request.`, { field: "number" });
    if (target.status === "closed") throw new AppError(422, "validation_failed", `#${number} is closed.`, { field: "number" });

    const note = `Merged into #${target.number}: ${target.title}`;
    await tx.query(
      `update tickets set merged_into_ticket_id = $2, status = 'resolved', resolved_at = now(), resolution_note = $3,
              updated_at = now(), version = version + 1 where id = $1`,
      [src.id, target.id, note],
    );
    await applySlaTransition(tx, src.id, { fromStatus: src.status, toStatus: "resolved" });
    await tx.query(
      "insert into ticket_messages (ticket_id, customer_id, author_user_id, visibility, body) values ($1, $2, $3, 'internal', $4)",
      [target.id, src.customer_id, p.userId, `Merged from #${src.number} (requested by ${src.requester_name}): ${src.title}\n\n${src.description}`.slice(0, 20000)],
    );
    const ev = "insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, to_value) values ($1, $2, $3, $4, $5)";
    await tx.query(ev, [src.id, src.customer_id, p.userId, "merged", `#${target.number}`]);
    await tx.query(ev, [target.id, src.customer_id, p.userId, "merged_from", `#${src.number}`]);
    await tx.query("update tickets set updated_at = now(), version = version + 1 where id = $1", [target.id]);
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'ticket.merge', 'ticket', $3, $4)",
      [p.userId, src.customer_id, src.id, JSON.stringify({ into: target.id })],
    );
    await emitTicketEvent(tx, src.id, "status_changed", "resolved");
    return { mergedInto: target.id, number: Number(target.number) };
  });
}

const parentSchema = z.object({ number: z.coerce.number().int().positive().nullable() });

export async function setParent(p: Principal, ticketId: string, raw: unknown) {
  const { number } = parentSchema.parse(raw);
  return withUser(p.userId, async (tx) => {
    const t = await staffTicket(tx, p, ticketId);
    let parentId: string | null = null;
    if (number !== null) {
      const parent = await byNumber(tx, t.customer_id, number);
      if (parent.id === t.id) throw new AppError(422, "validation_failed", "A request can't be its own parent.", { field: "number" });
      // No cycles: walk up from the proposed parent.
      let cur: string | null = parent.parent_ticket_id;
      for (let depth = 0; cur && depth < 50; depth++) {
        if (cur === t.id) throw new AppError(422, "validation_failed", "That would create a loop of parent requests.", { field: "number" });
        cur = (await tx.query<{ parent_ticket_id: string | null }>("select parent_ticket_id from tickets where id = $1", [cur])).rows[0]?.parent_ticket_id ?? null;
      }
      parentId = parent.id;
    }
    await tx.query("update tickets set parent_ticket_id = $2, updated_at = now(), version = version + 1 where id = $1", [t.id, parentId]);
    await tx.query("insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, to_value) values ($1, $2, $3, $4, $5)", [
      t.id,
      t.customer_id,
      p.userId,
      parentId ? "parent_set" : "parent_cleared",
      number !== null ? `#${number}` : null,
    ]);
    return { parentTicketId: parentId };
  });
}

export interface RelatedTickets {
  parent: { id: string; number: number; title: string; status: Status } | null;
  children: { id: string; number: number; title: string; status: Status }[];
  mergedInto: { id: string; number: number; title: string } | null;
}

/** Related requests the viewer can see (row-level security hides the rest). */
export async function relatedTickets(tx: Queryable, ticketId: string): Promise<RelatedTickets> {
  const self = await tx.query<{ parent_ticket_id: string | null; merged_into_ticket_id: string | null }>(
    "select parent_ticket_id, merged_into_ticket_id from tickets where id = $1",
    [ticketId],
  );
  const one = async (id: string | null) =>
    id ? (await tx.query<{ id: string; number: string; title: string; status: Status }>("select id, number, title, status from tickets where id = $1", [id])).rows[0] : undefined;
  const parent = await one(self.rows[0]?.parent_ticket_id ?? null);
  const merged = await one(self.rows[0]?.merged_into_ticket_id ?? null);
  const kids = await tx.query<{ id: string; number: string; title: string; status: Status }>(
    "select id, number, title, status from tickets where parent_ticket_id = $1 order by number",
    [ticketId],
  );
  return {
    parent: parent ? { id: parent.id, number: Number(parent.number), title: parent.title, status: parent.status } : null,
    children: kids.rows.map((k) => ({ id: k.id, number: Number(k.number), title: k.title, status: k.status })),
    mergedInto: merged ? { id: merged.id, number: Number(merged.number), title: merged.title } : null,
  };
}

// ---------------------------------------------------------------- assignment rules (operators)

export const ruleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    customerId: z.uuid().nullable(),
    active: z.boolean(),
    position: z.number().int().min(0).max(10000),
    matchCategory: z.enum(CATEGORIES).nullable(),
    matchPriority: z.enum(PRIORITIES).nullable(),
    matchKind: z.enum(["incident", "request"]).nullable(),
    matchKeyword: z.string().trim().min(2).max(80).nullable(),
    assignUserId: z.uuid().nullable(),
    assignQueueId: z.uuid().nullable(),
  })
  .refine((r) => r.assignUserId || r.assignQueueId, { error: "Choose a technician or a queue.", path: ["assignUserId"] });

export interface AssignmentRule {
  id: string;
  name: string;
  customerId: string | null;
  active: boolean;
  position: number;
  matchCategory: string | null;
  matchPriority: string | null;
  matchKind: string | null;
  matchKeyword: string | null;
  assignUserId: string | null;
  assignQueueId: string | null;
}

export async function listRules(p: Principal): Promise<AssignmentRule[]> {
  requireOperator(p);
  return asSystem(async (tx) =>
    (await tx.query("select * from assignment_rules order by (customer_id is null), position, created_at")).rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      customerId: (r.customer_id as string) ?? null,
      active: Boolean(r.active),
      position: Number(r.position),
      matchCategory: (r.match_category as string) ?? null,
      matchPriority: (r.match_priority as string) ?? null,
      matchKind: (r.match_kind as string) ?? null,
      matchKeyword: (r.match_keyword as string) ?? null,
      assignUserId: (r.assign_user_id as string) ?? null,
      assignQueueId: (r.assign_queue_id as string) ?? null,
    })),
  );
}

/** Technicians and queues an operator can choose for rules. */
export async function ruleTargets(p: Principal) {
  requireOperator(p);
  return asSystem(async (tx) => {
    const staff = await tx.query<{ id: string; display_name: string; customers: string[] }>(
      `select u.id, u.display_name, array_agg(m.customer_id::text) as customers from memberships m join users u on u.id = m.user_id
        where m.revoked_at is null and m.role in ('technician', 'service_manager') and u.status = 'active'
        group by u.id, u.display_name order by u.display_name`,
    );
    const queues = await tx.query<{ id: string; name: string }>("select id, name from queues order by name");
    return {
      staff: staff.rows.map((s) => ({ id: s.id, name: s.display_name, customerIds: s.customers })),
      queues: queues.rows,
    };
  });
}

export async function saveRule(p: Principal, id: string | null, raw: unknown) {
  requireOperator(p);
  const v = ruleSchema.parse(raw);
  return asSystem(async (tx) => {
    if (v.assignUserId && v.customerId) {
      const ok = await tx.query(
        "select 1 from memberships where user_id = $1 and customer_id = $2 and revoked_at is null and role in ('technician', 'service_manager')",
        [v.assignUserId, v.customerId],
      );
      if (!ok.rows[0]) throw new AppError(422, "validation_failed", "That technician isn't assigned to this customer.", { field: "assignUserId" });
    }
    const params = [v.name, v.customerId, v.active, v.position, v.matchCategory, v.matchPriority, v.matchKind, v.matchKeyword, v.assignUserId, v.assignQueueId];
    const r = id
      ? await tx.query<{ id: string }>(
          `update assignment_rules set name = $2, customer_id = $3, active = $4, position = $5, match_category = $6, match_priority = $7,
                  match_kind = $8, match_keyword = $9, assign_user_id = $10, assign_queue_id = $11, updated_at = now() where id = $1 returning id`,
          [id, ...params],
        )
      : await tx.query<{ id: string }>(
          `insert into assignment_rules (name, customer_id, active, position, match_category, match_priority, match_kind, match_keyword, assign_user_id, assign_queue_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
          params,
        );
    if (!r.rows[0]) throw notFound("Rule");
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, $3, 'assignment_rule', $4, $5)",
      [p.userId, v.customerId, id ? "rule.update" : "rule.create", r.rows[0].id, JSON.stringify({ name: v.name })],
    );
    return { id: r.rows[0].id };
  });
}

export async function deleteRule(p: Principal, id: string) {
  requireOperator(p);
  const r = await asSystem((tx) => tx.query("delete from assignment_rules where id = $1", [id]));
  if (!r.rowCount) throw notFound("Rule");
  return { ok: true };
}
