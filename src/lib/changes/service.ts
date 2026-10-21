import { z } from "zod";
import { withUser, type Queryable } from "../db";
import { customersWhere, isStaffFor, roleFor, STAFF_ROLES, type Principal } from "../authz";
import { AppError, forbidden, notFound } from "../errors";
import { approverRole } from "../catalog/read";

/**
 * Change management. Technicians draft a change, submit it, and run it in its
 * window. Approval depends on the type:
 * - standard: routine and pre-approved, so submitting schedules it;
 * - normal: approved by the customer's administrator (or a service manager when
 *   the customer has none);
 * - emergency: approved by a Hernandez Solutions service manager.
 * Client administrators see every change except drafts.
 */

export const CHANGE_TYPES = ["standard", "normal", "emergency"] as const;
export const RISKS = ["low", "medium", "high"] as const;
export type ChangeStatus = "draft" | "pending_approval" | "scheduled" | "in_progress" | "completed" | "failed" | "cancelled" | "rejected";

export const CHANGE_STATUS_LABEL: Record<ChangeStatus, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed, backed out",
  cancelled: "Cancelled",
  rejected: "Not approved",
};

const text = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\r\n/g, "\n").trim())
    .pipe(z.string().max(max));

export const changeSchema = z
  .object({
    customerId: z.uuid(),
    title: z.string().trim().min(3).max(200),
    description: text(20000).pipe(z.string().min(1, { error: "Describe the change." })),
    changeType: z.enum(CHANGE_TYPES),
    risk: z.enum(RISKS),
    impact: text(5000).default(""),
    implementationPlan: text(20000).default(""),
    backoutPlan: text(20000).default(""),
    plannedStart: z.iso.datetime({ offset: true }).nullable(),
    plannedEnd: z.iso.datetime({ offset: true }).nullable(),
    notifyCustomer: z.boolean().default(true),
    implementerUserId: z.uuid().nullable().default(null),
  })
  .refine((c) => !c.plannedStart || !c.plannedEnd || new Date(c.plannedEnd) > new Date(c.plannedStart), {
    error: "The window must end after it starts.",
    path: ["plannedEnd"],
  });

export interface ChangeSummary {
  id: string;
  number: number;
  customerId: string;
  customerName: string;
  title: string;
  changeType: (typeof CHANGE_TYPES)[number];
  risk: (typeof RISKS)[number];
  status: ChangeStatus;
  approvalStatus: "not_required" | "pending" | "approved" | "rejected";
  plannedStart: string | null;
  plannedEnd: string | null;
  notifyCustomer: boolean;
}

export interface ChangeDetail extends ChangeSummary {
  description: string;
  impact: string;
  implementationPlan: string;
  backoutPlan: string;
  createdByName: string;
  implementerUserId: string | null;
  implementerName: string | null;
  approvalNote: string | null;
  approvalDecidedByName: string | null;
  outcomeNote: string | null;
  version: number;
  events: { kind: string; actorName: string | null; note: string | null; createdAt: string }[];
  tickets: { id: string; number: number; title: string }[];
  viewer: { isStaff: boolean; canEdit: boolean; canDecide: boolean; actions: string[] };
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

function toSummary(r: Record<string, unknown>): ChangeSummary {
  return {
    id: r.id as string,
    number: Number(r.number),
    customerId: r.customer_id as string,
    customerName: r.customer_name as string,
    title: r.title as string,
    changeType: r.change_type as ChangeSummary["changeType"],
    risk: r.risk as ChangeSummary["risk"],
    status: r.status as ChangeStatus,
    approvalStatus: r.approval_status as ChangeSummary["approvalStatus"],
    plannedStart: iso(r.planned_start),
    plannedEnd: iso(r.planned_end),
    notifyCustomer: Boolean(r.notify_customer),
  };
}

export const listChangesSchema = z.object({
  customerId: z.uuid().optional(),
  scope: z.enum(["upcoming", "all"]).default("upcoming"),
});

/** Changes the viewer may see (staff: all for their customers; client admins: non-drafts). */
export async function listChanges(p: Principal, raw: unknown = {}): Promise<ChangeSummary[]> {
  const f = listChangesSchema.parse(raw);
  const allowed = customersWhere(p, (r) => r === "client_admin" || STAFF_ROLES.includes(r));
  const targets = f.customerId ? allowed.filter((c) => c === f.customerId) : allowed;
  if (!targets.length) return [];
  return withUser(p.userId, async (tx) => {
    const r = await tx.query(
      `select c.*, cu.name as customer_name from change_requests c join customers cu on cu.id = c.customer_id
        where c.customer_id = any($1::uuid[])
          ${f.scope === "upcoming" ? "and (c.status in ('draft', 'pending_approval', 'scheduled', 'in_progress') or c.finished_at > now() - interval '7 days')" : ""}
        order by coalesce(c.planned_start, c.created_at) ${f.scope === "upcoming" ? "asc" : "desc"} limit 200`,
      [targets],
    );
    return r.rows.map(toSummary);
  });
}

async function loadChange(tx: Queryable, p: Principal, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Change");
  const r = await tx.query(
    `select c.*, cu.name as customer_name, cb.display_name as created_by_name, im.display_name as implementer_name, ad.display_name as approval_decided_by_name
       from change_requests c join customers cu on cu.id = c.customer_id join users cb on cb.id = c.created_by
       left join users im on im.id = c.implementer_user_id left join users ad on ad.id = c.approval_decided_by
      where c.id = $1`,
    [id],
  );
  const c = r.rows[0];
  if (!c || !p.memberships.some((m) => m.customerId === c.customer_id)) throw notFound("Change");
  return c;
}

/** Who approves a change of this type for the customer. */
async function changeApprover(tx: Queryable, customerId: string, type: string): Promise<"client_admin" | "service_manager" | null> {
  if (type === "standard") return null;
  if (type === "emergency") return "service_manager";
  return approverRole(tx, customerId);
}

function canDecide(p: Principal, customerId: string, approver: "client_admin" | "service_manager" | null) {
  if (!approver) return false;
  const role = roleFor(p, customerId);
  return role === approver || role === "service_manager";
}

function staffActions(status: ChangeStatus): string[] {
  switch (status) {
    case "draft":
      return ["submit", "cancel"];
    case "pending_approval":
      return ["cancel"];
    case "scheduled":
      return ["start", "cancel"];
    case "in_progress":
      return ["complete", "fail"];
    default:
      return [];
  }
}

export async function getChange(p: Principal, id: string): Promise<ChangeDetail> {
  return withUser(p.userId, async (tx) => {
    const c = await loadChange(tx, p, id);
    const staff = isStaffFor(p, c.customer_id as string);
    const approver = await changeApprover(tx, c.customer_id as string, c.change_type as string);
    const events = await tx.query(
      `select e.kind, e.note, e.created_at, u.display_name from change_events e left join users u on u.id = e.actor_user_id
        where e.change_id = $1 order by e.created_at, e.id`,
      [id],
    );
    const tickets = await tx.query<{ id: string; number: string; title: string }>(
      `select t.id, t.number, t.title from change_tickets ct join tickets t on t.id = ct.ticket_id where ct.change_id = $1 order by t.number`,
      [id],
    );
    return {
      ...toSummary(c),
      description: c.description as string,
      impact: c.impact as string,
      implementationPlan: c.implementation_plan as string,
      backoutPlan: c.backout_plan as string,
      createdByName: c.created_by_name as string,
      implementerUserId: (c.implementer_user_id as string) ?? null,
      implementerName: (c.implementer_name as string) ?? null,
      approvalNote: (c.approval_note as string) ?? null,
      approvalDecidedByName: (c.approval_decided_by_name as string) ?? null,
      outcomeNote: (c.outcome_note as string) ?? null,
      version: Number(c.version),
      events: events.rows.map((e) => ({ kind: e.kind as string, actorName: (e.display_name as string) ?? null, note: (e.note as string) ?? null, createdAt: iso(e.created_at)! })),
      tickets: tickets.rows.map((t) => ({ id: t.id, number: Number(t.number), title: t.title })),
      viewer: {
        isStaff: staff,
        canEdit: staff && (c.status === "draft" || c.status === "scheduled"),
        canDecide: c.approval_status === "pending" && canDecide(p, c.customer_id as string, approver),
        actions: staff ? staffActions(c.status as ChangeStatus) : [],
      },
    };
  });
}

async function event(tx: Queryable, c: { id: string; customer_id: string }, p: Principal, kind: string, note?: string | null) {
  await tx.query("insert into change_events (change_id, customer_id, actor_user_id, kind, note) values ($1, $2, $3, $4, $5)", [c.id, c.customer_id, p.userId, kind, note ?? null]);
}

async function audit(tx: Queryable, p: Principal, customerId: string, changeId: string, action: string, details: object = {}) {
  await tx.query("insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, $3, 'change', $4, $5)", [
    p.userId,
    customerId,
    action,
    changeId,
    JSON.stringify(details),
  ]);
}

async function checkImplementer(tx: Queryable, customerId: string, userId: string | null) {
  if (!userId) return;
  const ok = await tx.query("select 1 from memberships where user_id = $1 and customer_id = $2 and revoked_at is null and role in ('technician', 'service_manager')", [userId, customerId]);
  if (!ok.rows[0]) throw new AppError(422, "validation_failed", "That person isn't a technician for this customer.", { field: "implementerUserId" });
}

export async function createChange(p: Principal, raw: unknown) {
  const v = changeSchema.parse(raw);
  if (!isStaffFor(p, v.customerId)) throw forbidden("Only technicians assigned to this customer can plan changes.");
  return withUser(p.userId, async (tx) => {
    await checkImplementer(tx, v.customerId, v.implementerUserId);
    const r = await tx.query<{ id: string; number: string; customer_id: string }>(
      `insert into change_requests (customer_id, title, description, change_type, risk, impact, implementation_plan, backout_plan, planned_start, planned_end,
                                    notify_customer, implementer_user_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id, number, customer_id`,
      [v.customerId, v.title, v.description, v.changeType, v.risk, v.impact, v.implementationPlan, v.backoutPlan, v.plannedStart, v.plannedEnd, v.notifyCustomer, v.implementerUserId, p.userId],
    );
    const c = r.rows[0];
    await event(tx, c, p, "created");
    await audit(tx, p, c.customer_id, c.id, "change.create", { type: v.changeType, risk: v.risk });
    return { id: c.id, number: Number(c.number) };
  });
}

export async function updateChange(p: Principal, id: string, raw: unknown) {
  const v = changeSchema.parse(raw);
  return withUser(p.userId, async (tx) => {
    const c = await loadChange(tx, p, id);
    if (!isStaffFor(p, c.customer_id as string)) throw forbidden("Only technicians can edit changes.");
    if (v.customerId !== c.customer_id) throw new AppError(422, "validation_failed", "A change can't move to another customer.", { field: "customerId" });
    if (c.status !== "draft" && c.status !== "scheduled") throw new AppError(409, "invalid_transition", "Only draft or scheduled changes can be edited.");
    await checkImplementer(tx, v.customerId, v.implementerUserId);
    // Editing a scheduled change that needed approval sends it back for approval.
    const reapprove = c.status === "scheduled" && c.change_type !== "standard";
    await tx.query(
      `update change_requests set title = $2, description = $3, change_type = $4, risk = $5, impact = $6, implementation_plan = $7, backout_plan = $8,
              planned_start = $9, planned_end = $10, notify_customer = $11, implementer_user_id = $12, updated_at = now(), version = version + 1
              ${reapprove ? ", status = 'draft', approval_status = 'not_required', approval_decided_by = null, approval_decided_at = null" : ""}
        where id = $1`,
      [id, v.title, v.description, v.changeType, v.risk, v.impact, v.implementationPlan, v.backoutPlan, v.plannedStart, v.plannedEnd, v.notifyCustomer, v.implementerUserId],
    );
    await event(tx, { id, customer_id: c.customer_id as string }, p, "edited", reapprove ? "Moved back to draft; submit again for approval." : null);
    return { ok: true, backToDraft: reapprove };
  });
}

export const actionSchema = z.object({
  action: z.enum(["submit", "start", "complete", "fail", "cancel"]),
  note: text(5000).optional(),
});

export async function changeAction(p: Principal, id: string, raw: unknown) {
  const { action, note } = actionSchema.parse(raw);
  return withUser(p.userId, async (tx) => {
    const c = await loadChange(tx, p, id);
    const customerId = c.customer_id as string;
    if (!isStaffFor(p, customerId)) throw forbidden("Only technicians can run changes.");
    const status = c.status as ChangeStatus;
    if (!staffActions(status).includes(action)) throw new AppError(409, "invalid_transition", `A ${CHANGE_STATUS_LABEL[status].toLowerCase()} change can't be ${action === "fail" ? "marked failed" : `${action}ed`}.`);
    const ref = { id, customer_id: customerId };
    let next: ChangeStatus;
    const sets: string[] = [];
    const params: unknown[] = [id];
    if (action === "submit") {
      if (!c.planned_start || !c.planned_end) throw new AppError(422, "validation_failed", "Set the maintenance window before submitting.", { field: "plannedStart" });
      if (!String(c.implementation_plan).trim() || !String(c.backout_plan).trim()) {
        throw new AppError(422, "validation_failed", "Add the implementation and backout plans before submitting.", { field: "implementationPlan" });
      }
      const approver = await changeApprover(tx, customerId, c.change_type as string);
      if (!approver) {
        next = "scheduled";
        sets.push("approval_status = 'not_required'");
      } else {
        next = "pending_approval";
        sets.push("approval_status = 'pending'");
      }
    } else if (action === "start") {
      next = "in_progress";
      sets.push("started_at = now()");
    } else if (action === "complete" || action === "fail") {
      if (!note || note.length < 5) throw new AppError(422, "validation_failed", "Describe the outcome.", { field: "note" });
      next = action === "complete" ? "completed" : "failed";
      params.push(note);
      sets.push("finished_at = now()", `outcome_note = $${params.length}`);
    } else {
      next = "cancelled";
      sets.push("finished_at = now()");
      if (note) {
        params.push(note);
        sets.push(`outcome_note = $${params.length}`);
      }
    }
    params.push(next);
    await tx.query(`update change_requests set status = $${params.length}, ${sets.join(", ")}, updated_at = now(), version = version + 1 where id = $1`, params);
    const kind = action === "submit" ? (next === "scheduled" ? "scheduled" : "submitted") : action === "start" ? "started" : action === "complete" ? "completed" : action === "fail" ? "failed" : "cancelled";
    await event(tx, ref, p, kind, note);
    await audit(tx, p, customerId, id, `change.${action}`);
    if (next === "pending_approval") await tx.query("select app_enqueue_change_event($1, 'change_approval_requested')", [id]);
    if (next === "scheduled" && c.notify_customer) await tx.query("select app_enqueue_change_event($1, 'change_scheduled')", [id]);
    if ((next === "completed" || next === "failed") && c.notify_customer) await tx.query("select app_enqueue_change_event($1, 'change_finished', $2)", [id, next]);
    return { status: next };
  });
}

export const decideSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: text(2000).optional(),
});

export async function decideChange(p: Principal, id: string, raw: unknown) {
  const v = decideSchema.parse(raw);
  if (v.decision === "rejected" && !v.note) throw new AppError(422, "validation_failed", "Say why, so the technician can revise the plan.", { field: "note" });
  return withUser(p.userId, async (tx) => {
    const c = await loadChange(tx, p, id);
    const customerId = c.customer_id as string;
    const approver = await changeApprover(tx, customerId, c.change_type as string);
    if (c.approval_status !== "pending") throw new AppError(409, "invalid_transition", "This change isn't waiting for approval.");
    if (!canDecide(p, customerId, approver)) throw forbidden(approver === "service_manager" ? "Emergency changes are approved by a Hernandez Solutions service manager." : "Only your organization's administrator can approve changes.");
    const next = v.decision === "approved" ? "scheduled" : "rejected";
    await tx.query(
      `update change_requests set approval_status = $2, status = $3, approval_decided_by = $4, approval_decided_at = now(), approval_note = $5,
              updated_at = now(), version = version + 1 where id = $1 and approval_status = 'pending'`,
      [id, v.decision, next, p.userId, v.note ?? null],
    );
    await event(tx, { id, customer_id: customerId }, p, v.decision, v.note);
    await audit(tx, p, customerId, id, "change.approval", { decision: v.decision });
    await tx.query("select app_enqueue_change_event($1, 'change_decided', $2)", [id, v.decision]);
    if (next === "scheduled" && c.notify_customer) await tx.query("select app_enqueue_change_event($1, 'change_scheduled')", [id]);
    return { status: next };
  });
}

const linkSchema = z.object({ number: z.coerce.number().int().positive(), remove: z.boolean().default(false) });

export async function linkChangeTicket(p: Principal, id: string, raw: unknown) {
  const { number, remove } = linkSchema.parse(raw);
  return withUser(p.userId, async (tx) => {
    const c = await loadChange(tx, p, id);
    const customerId = c.customer_id as string;
    if (!isStaffFor(p, customerId)) throw forbidden("Only technicians can link tickets.");
    const t = await tx.query<{ id: string }>("select id from tickets where number = $1 and customer_id = $2", [number, customerId]);
    if (!t.rows[0]) throw new AppError(422, "validation_failed", `There's no request #${number} for this customer.`, { field: "number" });
    if (remove) await tx.query("delete from change_tickets where change_id = $1 and ticket_id = $2", [id, t.rows[0].id]);
    else await tx.query("insert into change_tickets (change_id, ticket_id, customer_id) values ($1, $2, $3) on conflict do nothing", [id, t.rows[0].id, customerId]);
    return { ok: true };
  });
}
