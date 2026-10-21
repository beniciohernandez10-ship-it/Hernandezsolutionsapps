import { z } from "zod";
import { asSystem, withUser, type Queryable } from "../db";
import { isStaffFor, requireMember, requireOperator, type Principal } from "../authz";
import { AppError, forbidden, notFound } from "../errors";
import { emitTicketEvent } from "../notify/service";
import { createTicket } from "../tickets/service";
import { CATEGORIES, PRIORITIES, type Category, type Priority } from "../tickets/schemas";
import { describeAnswers, fieldsSchema, validateAnswers, type CatalogField } from "./fields";
import { approverRole, canApprove } from "./read";

/**
 * Service catalog. A catalog request is a ticket of kind "request" with the
 * submitted answers attached. Items that need approval wait for a client
 * administrator of the customer (or a service manager if the customer has
 * none); the fulfilment checklist is created only once the request may go ahead.
 */

export interface CatalogItem {
  id: string;
  customerId: string | null;
  name: string;
  summary: string;
  category: Category;
  defaultPriority: Priority;
  fields: CatalogField[];
  tasks: string[];
  requiresApproval: boolean;
  active: boolean;
  sortOrder: number;
}

function toItem(r: Record<string, unknown>): CatalogItem {
  return {
    id: r.id as string,
    customerId: (r.customer_id as string) ?? null,
    name: r.name as string,
    summary: r.summary as string,
    category: r.category as Category,
    defaultPriority: r.default_priority as Priority,
    fields: (r.fields as CatalogField[]) ?? [],
    tasks: (r.tasks as string[]) ?? [],
    requiresApproval: Boolean(r.requires_approval),
    active: Boolean(r.active),
    sortOrder: Number(r.sort_order),
  };
}

/** Active items offered to the principal's organizations (RLS applies the same rule). */
export async function listCatalog(p: Principal): Promise<CatalogItem[]> {
  if (!p.memberships.length) return [];
  return withUser(p.userId, async (tx) => {
    const r = await tx.query(
      "select * from catalog_items where active and (customer_id is null or customer_id = any($1::uuid[])) order by sort_order, name",
      [p.memberships.map((m) => m.customerId)],
    );
    return r.rows.map(toItem);
  });
}

export async function getCatalogItem(p: Principal, id: string): Promise<CatalogItem> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Request type");
  const item = (await listCatalog(p)).find((i) => i.id === id);
  if (!item) throw notFound("Request type");
  return item;
}

/** Builds the checklist from the item's template once the request may proceed (database function, see 0005). */
async function createTasks(tx: Queryable, ticketId: string) {
  await tx.query("select app_create_request_tasks($1)", [ticketId]);
}

export const submitSchema = z.object({
  customerId: z.uuid().optional(),
  answers: z.record(z.string(), z.unknown()).default({}),
  priority: z.enum(PRIORITIES).optional(),
  notes: z.string().max(5000).optional(),
});

export async function submitRequest(p: Principal, itemId: string, raw: unknown, idempotencyKey: string) {
  const input = submitSchema.parse(raw);
  const item = await getCatalogItem(p, itemId);
  let customerId = input.customerId ?? item.customerId ?? undefined;
  if (!customerId) {
    if (p.memberships.length !== 1) throw new AppError(422, "validation_failed", "Choose an organization.", { field: "customerId" });
    customerId = p.memberships[0].customerId;
  }
  requireMember(p, customerId);
  if (item.customerId && item.customerId !== customerId) throw notFound("Request type");
  const answers = validateAnswers(item.fields, input.answers);
  const first = answers.find((a) => a.value && a.value !== "Yes" && a.value !== "No");
  const title = `${item.name}${first ? `: ${first.value.split("\n")[0]}` : ""}`.slice(0, 200);
  const notes = input.notes?.trim() || undefined;
  const requestData = [...answers.map(({ label, value }) => ({ label, value })), ...(notes ? [{ label: "Anything else", value: notes }] : [])];

  return createTicket(
    p,
    {
      title,
      description: describeAnswers(item.name, answers, notes),
      priority: input.priority ?? item.defaultPriority,
      category: CATEGORIES.includes(item.category) ? item.category : "general",
      customerId,
    },
    idempotencyKey,
    {
      kind: "request",
      catalogItemId: item.id,
      requestData,
      afterInsert: async (tx, ticket, cust) => {
        if (!item.requiresApproval) {
          await createTasks(tx, ticket.id);
          return;
        }
        const approver = await approverRole(tx, cust);
        await tx.query("insert into approvals (ticket_id, customer_id, requested_by) values ($1, $2, $3)", [ticket.id, cust, p.userId]);
        if (canApprove(p, cust, approver)) {
          // The person who would approve it asked for it: approved on submission.
          await tx.query(
            "update approvals set status = 'approved', decided_by = $2, decided_at = now(), note = 'Requested by an approver' where ticket_id = $1 and status = 'pending'",
            [ticket.id, p.userId],
          );
          await tx.query("update tickets set approval_status = 'approved' where id = $1", [ticket.id]);
          await createTasks(tx, ticket.id);
        } else {
          await tx.query("update tickets set approval_status = 'pending' where id = $1", [ticket.id]);
          await tx.query(
            "insert into ticket_events (ticket_id, customer_id, actor_user_id, kind) values ($1, $2, $3, 'approval_requested')",
            [ticket.id, cust, p.userId],
          );
          await emitTicketEvent(tx, ticket.id, "approval_requested");
        }
      },
    },
  );
}

export const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(2000).optional(),
});

export async function decideApproval(p: Principal, ticketId: string, raw: unknown) {
  const input = decisionSchema.parse(raw);
  if (input.decision === "rejected" && !input.note) throw new AppError(422, "validation_failed", "Say why, so the requester knows what to do next.", { field: "note" });
  return withUser(p.userId, async (tx) => {
    const t = await tx.query<{ id: string; customer_id: string; catalog_item_id: string | null; status: string }>(
      "select id, customer_id, catalog_item_id, status from tickets where id = $1",
      [ticketId],
    );
    const ticket = t.rows[0];
    if (!ticket || !p.memberships.some((m) => m.customerId === ticket.customer_id)) throw notFound("Ticket");
    const approver = await approverRole(tx, ticket.customer_id);
    if (!canApprove(p, ticket.customer_id, approver)) throw forbidden("Only an administrator for your organization can approve requests.");
    const a = await tx.query(
      "update approvals set status = $2, decided_by = $3, decided_at = now(), note = $4 where ticket_id = $1 and status = 'pending' returning id",
      [ticketId, input.decision, p.userId, input.note ?? null],
    );
    if (!a.rowCount) throw new AppError(409, "invalid_transition", "This request isn't waiting for approval.");
    await tx.query(
      `update tickets set approval_status = $2, updated_at = now(), version = version + 1
         ${input.decision === "rejected" ? ", status = 'resolved', resolved_at = now(), resolution_note = $3" : ""} where id = $1`,
      input.decision === "rejected" ? [ticketId, input.decision, `Not approved: ${input.note}`] : [ticketId, input.decision],
    );
    await tx.query("insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, to_value) values ($1, $2, $3, $4, $5)", [
      ticketId,
      ticket.customer_id,
      p.userId,
      input.decision,
      input.note ? "with a note" : null,
    ]);
    if (input.note) {
      await tx.query("insert into ticket_messages (ticket_id, customer_id, author_user_id, visibility, body) values ($1, $2, $3, 'public', $4)", [
        ticketId,
        ticket.customer_id,
        p.userId,
        `${input.decision === "approved" ? "Approved" : "Not approved"}: ${input.note}`,
      ]);
    }
    if (input.decision === "approved") await createTasks(tx, ticketId);
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'ticket.approval', 'ticket', $3, $4)",
      [p.userId, ticket.customer_id, ticketId, JSON.stringify({ decision: input.decision })],
    );
    await emitTicketEvent(tx, ticketId, "approval_decided", input.decision);
    return { approvalStatus: input.decision };
  });
}

// ---------------------------------------------------------------- tasks

async function staffTicket(tx: Queryable, p: Principal, ticketId: string) {
  const t = await tx.query<{ customer_id: string }>("select customer_id from tickets where id = $1", [ticketId]);
  const c = t.rows[0]?.customer_id;
  if (!c || !p.memberships.some((m) => m.customerId === c)) throw notFound("Ticket");
  if (!isStaffFor(p, c)) throw forbidden("Only technicians can change the checklist.");
  return c;
}

export const taskSchema = z.object({ title: z.string().trim().min(1).max(200) });

export async function addTask(p: Principal, ticketId: string, raw: unknown) {
  const { title } = taskSchema.parse(raw);
  return withUser(p.userId, async (tx) => {
    const c = await staffTicket(tx, p, ticketId);
    const pos = await tx.query<{ n: number }>("select coalesce(max(position), -1)::int + 1 as n from ticket_tasks where ticket_id = $1", [ticketId]);
    const r = await tx.query<{ id: string }>("insert into ticket_tasks (ticket_id, customer_id, title, position) values ($1, $2, $3, $4) returning id", [
      ticketId,
      c,
      title,
      pos.rows[0].n,
    ]);
    return { id: r.rows[0].id };
  });
}

export async function setTaskDone(p: Principal, ticketId: string, taskId: string, done: boolean) {
  return withUser(p.userId, async (tx) => {
    const c = await staffTicket(tx, p, ticketId);
    const r = await tx.query(
      `update ticket_tasks set done_at = ${done ? "coalesce(done_at, now())" : "null"}, done_by = ${done ? "coalesce(done_by, $3)" : "null"}
        where id = $1 and ticket_id = $2 returning id`,
      done ? [taskId, ticketId, p.userId] : [taskId, ticketId],
    );
    if (!r.rowCount) throw notFound("Task");
    if (done) {
      await tx.query("insert into ticket_events (ticket_id, customer_id, actor_user_id, kind) values ($1, $2, $3, 'task_completed')", [ticketId, c, p.userId]);
    }
    await tx.query("update tickets set updated_at = now(), version = version + 1 where id = $1", [ticketId]);
    return { ok: true };
  });
}

/** Requests waiting for this person's decision. */
export async function pendingApprovals(p: Principal) {
  const mine = p.memberships.filter((m) => m.role === "client_admin" || m.role === "service_manager").map((m) => m.customerId);
  if (!mine.length) return [];
  return withUser(p.userId, async (tx) => {
    const r = await tx.query<{ id: string; number: string; title: string; customer_id: string; name: string; display_name: string; created_at: string }>(
      `select t.id, t.number, t.title, t.customer_id, c.name, u.display_name, a.created_at
         from approvals a join tickets t on t.id = a.ticket_id join customers c on c.id = t.customer_id join users u on u.id = t.requester_user_id
        where a.status = 'pending' and a.customer_id = any($1::uuid[]) order by a.created_at`,
      [mine],
    );
    const out = [];
    for (const x of r.rows) {
      if (canApprove(p, x.customer_id, await approverRole(tx, x.customer_id))) {
        out.push({ ticketId: x.id, number: Number(x.number), title: x.title, customerName: x.name, requesterName: x.display_name, requestedAt: new Date(x.created_at).toISOString() });
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------- operator management

export const catalogItemSchema = z.object({
  customerId: z.uuid().nullable(),
  name: z.string().trim().min(3).max(120),
  summary: z.string().trim().max(300).default(""),
  category: z.enum(CATEGORIES),
  defaultPriority: z.enum(PRIORITIES),
  fields: fieldsSchema,
  tasks: z.array(z.string().trim().min(1).max(200)).max(40),
  requiresApproval: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(10000),
});

export async function listCatalogForOperator(p: Principal): Promise<CatalogItem[]> {
  requireOperator(p);
  return asSystem(async (tx) => (await tx.query("select * from catalog_items order by sort_order, name")).rows.map(toItem));
}

export async function saveCatalogItem(p: Principal, id: string | null, raw: unknown) {
  requireOperator(p);
  const v = catalogItemSchema.parse(raw);
  return asSystem(async (tx) => {
    const params = [v.customerId, v.name, v.summary, v.category, v.defaultPriority, JSON.stringify(v.fields), JSON.stringify(v.tasks), v.requiresApproval, v.active, v.sortOrder];
    const r = id
      ? await tx.query<{ id: string }>(
          `update catalog_items set customer_id = $2, name = $3, summary = $4, category = $5, default_priority = $6, fields = $7, tasks = $8,
                  requires_approval = $9, active = $10, sort_order = $11, updated_at = now() where id = $1 returning id`,
          [id, ...params],
        )
      : await tx.query<{ id: string }>(
          `insert into catalog_items (customer_id, name, summary, category, default_priority, fields, tasks, requires_approval, active, sort_order)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
          params,
        );
    if (!r.rows[0]) throw notFound("Request type");
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, $3, 'catalog_item', $4, $5)",
      [p.userId, v.customerId, id ? "catalog.update" : "catalog.create", r.rows[0].id, JSON.stringify({ name: v.name, active: v.active })],
    );
    return { id: r.rows[0].id };
  });
}
