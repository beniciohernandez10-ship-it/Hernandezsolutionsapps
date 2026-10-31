import { z } from "zod";
import { asSystem, withUser, type Queryable } from "../db";
import { isStaffFor, requireMember, requireOperator, type Principal } from "../authz";
import { AppError, forbidden, notFound } from "../errors";
import { createTicket } from "../tickets/service";
import { CATEGORIES, PRIORITIES, type Category, type Priority } from "../tickets/schemas";
import { describeAnswers, fieldsSchema, validateAnswers, type CatalogField } from "./fields";
import { openHardwareOrder } from "../hardware/service";
import { applicableSteps, startApprovals, stepsSchema, type ApprovalStep } from "./workflow";

export { decideApproval, decisionSchema, pendingApprovals } from "./workflow";

/**
 * Service catalog. A catalog request is a ticket of kind "request" with the
 * submitted answers attached. Items that need approval wait for the company's
 * named approvers, or its client administrators if it has none (service
 * managers can always decide); the fulfilment checklist is created only once
 * the request may go ahead. Items with the "hardware" workflow then follow
 * the ordering path in src/lib/hardware/service.ts.
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
  /** Approval steps in order (empty: one step with the company's usual approvers, if requiresApproval). */
  approvalSteps: ApprovalStep[];
  /** "hardware": approve -> order -> receive and register -> deliver. */
  workflow: "standard" | "hardware";
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
    requiresApproval: Boolean(r.requires_approval) || ((r.approval_steps as ApprovalStep[]) ?? []).length > 0,
    approvalSteps: (r.approval_steps as ApprovalStep[]) ?? [],
    workflow: r.workflow === "hardware" ? "hardware" : "standard",
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

  const steps = applicableSteps(item, answers);
  const result = await createTicket(
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
        const hardware = item.workflow === "hardware";
        if (!steps.length) {
          await createTasks(tx, ticket.id);
          if (hardware) await openHardwareOrder(tx, p, ticket.id, cust, true);
          return;
        }
        // Approvers are asked right after the ticket is saved (startApprovals), from the plan fixed here.
        if (hardware) await openHardwareOrder(tx, p, ticket.id, cust, false);
        await tx.query("update tickets set approval_status = 'pending', approval_plan = $2 where id = $1", [ticket.id, JSON.stringify(steps)]);
        await tx.query("insert into ticket_events (ticket_id, customer_id, actor_user_id, kind) values ($1, $2, $3, 'approval_requested')", [
          ticket.id,
          cust,
          p.userId,
        ]);
      },
    },
  );
  if (steps.length && !result.replayed) await startApprovals(result.id, p);
  return result;
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
  approvalSteps: stepsSchema.default([]),
  workflow: z.enum(["standard", "hardware"]).default("standard"),
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
        const fieldLabels = new Set(v.fields.map((f) => f.label.trim().toLowerCase()));
    const missing = v.approvalSteps.find((st) => st.condition && !fieldLabels.has(st.condition.field.trim().toLowerCase()));
    if (missing) throw new AppError(422, "validation_failed", `"${missing.name}" depends on a question this form doesn't have: ${missing.condition!.field}.`, { field: "approvalSteps" });
    const params = [v.customerId, v.name, v.summary, v.category, v.defaultPriority, JSON.stringify(v.fields), JSON.stringify(v.tasks), v.requiresApproval || v.approvalSteps.length > 0, v.active, v.sortOrder, v.workflow, JSON.stringify(v.approvalSteps)];
    const r = id
      ? await tx.query<{ id: string }>(
          `update catalog_items set customer_id = $2, name = $3, summary = $4, category = $5, default_priority = $6, fields = $7, tasks = $8,
                  requires_approval = $9, active = $10, sort_order = $11, workflow = $12, approval_steps = $13, updated_at = now() where id = $1 returning id`,
          [id, ...params],
        )
      : await tx.query<{ id: string }>(
          `insert into catalog_items (customer_id, name, summary, category, default_priority, fields, tasks, requires_approval, active, sort_order, workflow, approval_steps)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
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
