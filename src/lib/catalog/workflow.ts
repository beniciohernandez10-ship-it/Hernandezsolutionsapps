import { z } from "zod";
import { asSystem, type Queryable } from "../db";
import { canSeeOrgFor, loadPrincipal, roleFor, type Principal } from "../authz";
import { emailSendingEnabled } from "../config";
import { AppError, forbidden, notFound } from "../errors";
import { enqueue } from "../jobs-queue";
import { log, errorSummary } from "../log";
import { cancelHardwareOrder, sendToOrdering } from "../hardware/service";
import { canDecideSlot, type RequestApprovers, type SlotRow } from "./read";

/**
 * Approval workflows for catalog requests.
 *
 * An item's workflow is a list of steps, run in order. Each step asks one or
 * more approvers (the company's usual approvers, everyone in a role, or a
 * named person) who decide in parallel: "any" finishes the step at the first
 * approval, "all" needs every one. A step can apply only when a form answer
 * matches. Any rejection ends the request. The steps that apply are fixed on
 * the ticket at submission (approval_plan).
 *
 * Service managers can always decide. Someone away can delegate their
 * approvals to a colleague for a date range; the colleague then decides on
 * their behalf. Approval emails can be answered "approve" or "reject <why>".
 */

export const APPROVER_ROLES = ["client_admin", "service_manager"] as const;
export const CONDITION_OPS = ["equals", "not_equals", "contains", "greater_than", "less_than"] as const;

const approverSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("default") }),
  z.object({ type: z.literal("role"), role: z.enum(APPROVER_ROLES) }),
  z.object({ type: z.literal("user"), userId: z.uuid() }),
]);
export type ApproverRef = z.infer<typeof approverSchema>;

export const stepSchema = z.object({
  name: z.string().trim().min(1, { error: "Name each step." }).max(80),
  mode: z.enum(["any", "all"]).default("any"),
  approvers: z.array(approverSchema).min(1, { error: "Each step needs at least one approver." }).max(6),
  condition: z
    .object({
      field: z.string().trim().min(1).max(120),
      op: z.enum(CONDITION_OPS),
      value: z.string().trim().max(200),
    })
    .nullable()
    .default(null),
});
export type ApprovalStep = z.infer<typeof stepSchema>;
export const stepsSchema = z.array(stepSchema).max(6, { error: "Keep it to 6 steps." });

const DEFAULT_STEP: ApprovalStep = { name: "Approval", mode: "any", approvers: [{ type: "default" }], condition: null };

const asNumber = (s: string) => {
  const cleaned = s.replace(/[$,\s]/g, "");
  // Blank isn't zero: a missing answer must not satisfy "less than".
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

/** Whether a step's condition holds for the submitted answers (no condition: always). */
export function conditionMet(c: ApprovalStep["condition"], answers: { label: string; value: string }[]) {
  if (!c) return true;
  const a = answers.find((x) => x.label.trim().toLowerCase() === c.field.trim().toLowerCase());
  const v = (a?.value ?? "").trim();
  const want = c.value.trim();
  switch (c.op) {
    case "equals":
      return v.toLowerCase() === want.toLowerCase();
    case "not_equals":
      return v.toLowerCase() !== want.toLowerCase();
    case "contains":
      return v.toLowerCase().includes(want.toLowerCase());
    case "greater_than":
    case "less_than": {
      const x = asNumber(v);
      const y = asNumber(want);
      if (x === null || y === null) return false;
      return c.op === "greater_than" ? x > y : x < y;
    }
  }
}

/** The steps that apply to one submission. An item that only "needs approval" gets the usual single step. */
export function applicableSteps(item: { requiresApproval: boolean; approvalSteps: ApprovalStep[] }, answers: { label: string; value: string }[]) {
  if (item.approvalSteps.length) return item.approvalSteps.filter((s) => conditionMet(s.condition, answers));
  return item.requiresApproval ? [DEFAULT_STEP] : [];
}

// ---------------------------------------------------------------- who may decide

/**
 * The company's usual approvers, in system context (the database helpers
 * behind requestApprovers only answer for a signed-in member).
 */
async function usualApprovers(tx: Queryable, customerId: string): Promise<RequestApprovers> {
  const named = await tx.query<{ name: string }>(
    `select u.display_name as name from customer_approvers a
       join memberships m on m.user_id = a.user_id and m.customer_id = a.customer_id and m.revoked_at is null
       join users u on u.id = a.user_id and u.status = 'active'
      where a.customer_id = $1 order by u.display_name`,
    [customerId],
  );
  if (named.rows.length) return { mode: "named", names: named.rows.map((r) => r.name) };
  const admin = await tx.query(
    "select 1 from memberships m join users u on u.id = m.user_id where m.customer_id = $1 and m.role = 'client_admin' and m.revoked_at is null and u.status = 'active' limit 1",
    [customerId],
  );
  return { mode: admin.rows[0] ? "client_admin" : "service_manager" };
}

/** People whose approvals this person may decide today (themselves first, then anyone who delegated to them). */
async function actingAs(tx: Queryable, p: Principal): Promise<Principal[]> {
  const d = await tx.query<{ user_id: string }>(
    "select distinct user_id from approval_delegations where delegate_user_id = $1 and (now() at time zone 'America/Los_Angeles')::date between starts_on and ends_on",
    [p.userId],
  );
  const out = [p];
  for (const r of d.rows) {
    const q = await loadPrincipal(tx, r.user_id);
    if (q) out.push(q);
  }
  return out;
}

/** The slot `p` may decide on a ticket's current step, and on whose behalf. System context. */
async function decidableSlot(tx: Queryable, p: Principal, rows: SlotRow[], approvalId?: string) {
  if (!rows.length) return null;
  const cust = rows[0].customer_id;
  // A delegate must still belong to the company.
  if (!roleFor(p, cust)) return null;
  const defaults = await usualApprovers(tx, cust);
  const as = await actingAs(tx, p);
  for (const row of rows) {
    if (approvalId && row.id !== approvalId) continue;
    for (const who of as) {
      const standingIn = who.userId !== p.userId;
      // Standing in for someone never lets a person approve their own request.
      if (standingIn && row.requested_by === p.userId) continue;
      if (canDecideSlot(who, row, defaults)) return { row, onBehalfOf: standingIn ? who.userId : null };
    }
  }
  return null;
}

// ---------------------------------------------------------------- running the plan

async function labelFor(tx: Queryable, cust: string, a: ApproverRef, defaults: RequestApprovers) {
  if (a.type === "user") return (await tx.query<{ display_name: string }>("select display_name from users where id = $1", [a.userId])).rows[0]?.display_name ?? "A named approver";
  if (a.type === "role") return a.role === "client_admin" ? "your organization's administrator" : "Hernandez Solutions";
  return defaults.mode === "named" ? defaults.names.join(" or ") : defaults.mode === "client_admin" ? "your organization's administrator" : "Hernandez Solutions";
}

/** Creates the pending slots for one step. A named person who has left the company is replaced by the usual approvers. */
async function openStep(tx: Queryable, ticket: { id: string; customer_id: string; requester_user_id: string }, plan: ApprovalStep[], index: number) {
  const step = plan[index];
  const defaults = await usualApprovers(tx, ticket.customer_id);
  const refs: ApproverRef[] = [];
  for (const a of step.approvers) {
    let ref = a;
    if (a.type === "user") {
      const ok = await tx.query(
        "select 1 from memberships m join users u on u.id = m.user_id where m.user_id = $1 and m.customer_id = $2 and m.revoked_at is null and u.status = 'active'",
        [a.userId, ticket.customer_id],
      );
      if (!ok.rows[0]) ref = { type: "default" };
    }
    if (!refs.some((r) => JSON.stringify(r) === JSON.stringify(ref))) refs.push(ref);
  }
  for (const [slot, a] of refs.entries()) {
    await tx.query(
      `insert into approvals (ticket_id, customer_id, requested_by, step_index, step_name, step_mode, slot, approver_kind, approver_role, approver_user_id, approver_label)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        ticket.id, ticket.customer_id, ticket.requester_user_id, index, step.name, step.mode, slot, a.type,
        a.type === "role" ? a.role : null, a.type === "user" ? a.userId : null, await labelFor(tx, ticket.customer_id, a, defaults),
      ],
    );
  }
}

/** Everyone to ask for one slot: the people it names, plus anyone they've delegated to. */
async function recipientsFor(tx: Queryable, row: SlotRow) {
  let ids: string[] = [];
  const members = await tx.query<{ user_id: string; role: string }>(
    "select m.user_id, m.role from memberships m join users u on u.id = m.user_id where m.customer_id = $1 and m.revoked_at is null and u.status = 'active'",
    [row.customer_id],
  );
  const inRole = (r: string) => members.rows.filter((m) => m.role === r).map((m) => m.user_id);
  if (row.approver_kind === "user" && row.approver_user_id) ids = [row.approver_user_id];
  else if (row.approver_kind === "role") ids = inRole(row.approver_role!);
  else {
    const named = await tx.query<{ user_id: string }>("select user_id from customer_approvers where customer_id = $1", [row.customer_id]);
    const active = new Set(members.rows.map((m) => m.user_id));
    const n = named.rows.map((r) => r.user_id).filter((u) => active.has(u));
    ids = n.length ? n : inRole("client_admin").length ? inRole("client_admin") : inRole("service_manager");
  }
  const d = await tx.query<{ delegate_user_id: string }>(
    `select d.delegate_user_id from approval_delegations d
      join memberships m on m.user_id = d.delegate_user_id and m.customer_id = $2 and m.revoked_at is null
     where d.user_id = any($1::uuid[]) and (now() at time zone 'America/Los_Angeles')::date between d.starts_on and d.ends_on`,
    [ids, row.customer_id],
  );
  return [...new Set([...ids, ...d.rows.map((r) => r.delegate_user_id)])];
}

/** In-app and email notifications for slots nobody has been told about yet. */
async function notifyApprovers(tx: Queryable, rows: SlotRow[], requesterId: string) {
  const told = new Set<string>();
  for (const row of rows) {
    if (row.status !== "pending" || row.notified_at) continue;
    for (const userId of await recipientsFor(tx, row)) {
      if (userId === requesterId || told.has(userId)) continue;
      told.add(userId);
      const n = await tx.query<{ id: string }>(
        "insert into notifications (user_id, customer_id, ticket_id, kind, actor_user_id, approval_id) values ($1, $2, $3, 'approval_requested', $4, $5) returning id",
        [userId, row.customer_id, row.ticket_id, requesterId, row.id],
      );
      const u = (
        await tx.query<{ email: string; is_demo: boolean; is_system: boolean; email_enabled: boolean | null; email_ticket_updates: boolean | null }>(
          `select u.email, u.is_demo, u.is_system, p.email_enabled, p.email_ticket_updates from users u
             left join notification_preferences p on p.user_id = u.id where u.id = $1`,
          [userId],
        )
      ).rows[0];
      const wants = u && !u.is_demo && !u.is_system && u.email_enabled !== false && u.email_ticket_updates !== false && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email);
      if (wants && emailSendingEnabled()) {
        await enqueue(tx, "email.notification", row.customer_id, { notificationId: n.rows[0].id, category: "email_ticket_updates" }, `email:${n.rows[0].id}`);
      }
    }
    await tx.query("update approvals set notified_at = now() where id = $1", [row.id]);
  }
}

async function createTasksSystem(tx: Queryable, ticketId: string) {
  await tx.query(
    `insert into ticket_tasks (ticket_id, customer_id, title, position)
     select t.id, t.customer_id, left(x.title, 200), x.n - 1
       from tickets t join catalog_items c on c.id = t.catalog_item_id,
            jsonb_array_elements_text(c.tasks) with ordinality as x(title, n)
      where t.id = $1 and not exists (select 1 from ticket_tasks k where k.ticket_id = t.id)`,
    [ticketId],
  );
}

const slotsOf = async (tx: Queryable, ticketId: string, step?: number) =>
  (
    await tx.query<SlotRow>(
      `select id, ticket_id, customer_id, requested_by, status, step_index, step_name, step_mode, slot, approver_kind, approver_role, approver_user_id, approver_label, notified_at
         from approvals where ticket_id = $1 and ($2::int is null or step_index = $2) order by step_index, slot`,
      [ticketId, step ?? null],
    )
  ).rows;

/**
 * Moves a pending request along its plan: opens the next step when the
 * current one is done, approves slots the requester could decide themselves,
 * tells approvers, and finishes the request when the last step is done.
 * System context; safe to call again.
 */
async function progress(tx: Queryable, ticketId: string, actor: Principal) {
  for (let guard = 0; guard < 10; guard++) {
    const t = (
      await tx.query<{ id: string; customer_id: string; requester_user_id: string; approval_status: string; approval_plan: ApprovalStep[] | null }>(
        "select id, customer_id, requester_user_id, approval_status, approval_plan from tickets where id = $1 for update",
        [ticketId],
      )
    ).rows[0];
    if (!t || t.approval_status !== "pending") return t?.approval_status ?? null;
    const plan = t.approval_plan?.length ? t.approval_plan : [DEFAULT_STEP];
    const all = await slotsOf(tx, ticketId);
    const current = all.length ? Math.max(...all.map((r) => r.step_index)) : -1;
    if (current < 0) {
      await openStep(tx, t, plan, 0);
      continue;
    }
    let rows = all.filter((r) => r.step_index === current);
    // The person who would approve it asked for it: approved on submission (as before workflows).
    const requester = await loadPrincipal(tx, t.requester_user_id);
    if (requester) {
      const defaults = await usualApprovers(tx, t.customer_id);
      for (const r of rows) {
        if (r.status === "pending" && canDecideSlot(requester, r, defaults)) {
          await tx.query(
            "update approvals set status = 'approved', decided_by = $2, decided_at = now(), note = 'Requested by an approver', decided_via = 'automatic' where id = $1 and status = 'pending'",
            [r.id, requester.userId],
          );
        }
      }
      rows = await slotsOf(tx, ticketId, current);
    }
    const approved = rows.filter((r) => r.status === "approved").length;
    const done = rows[0].step_mode === "all" ? rows.every((r) => r.status === "approved") : approved > 0;
    if (!done) {
      await notifyApprovers(tx, rows, t.requester_user_id);
      return "pending";
    }
    await tx.query("update approvals set status = 'cancelled' where ticket_id = $1 and step_index = $2 and status = 'pending'", [ticketId, current]);
    if (current + 1 < plan.length) {
      await openStep(tx, t, plan, current + 1);
      continue;
    }
    // Every step is done.
    await tx.query("update tickets set approval_status = 'approved', updated_at = now(), version = version + 1 where id = $1", [ticketId]);
    await sendToOrdering(tx, actor, ticketId, t.customer_id);
    await createTasksSystem(tx, ticketId);
    await enqueue(tx, "notify.ticket", t.customer_id, { ticketId, event: "approval_decided", actorUserId: actor.userId, detail: "approved", ref: null });
    return "approved";
  }
  throw new Error("approval workflow did not settle");
}

/** After a request is submitted (or to repair one left half-started). */
export async function startApprovals(ticketId: string, actor: Principal) {
  return asSystem((tx) => progress(tx, ticketId, actor));
}

/** Cron: requests waiting for approval with nothing to approve (a failed start) get their first step. */
export async function repairApprovals() {
  const r = await asSystem((tx) =>
    tx.query<{ id: string; requester_user_id: string }>(
      `select t.id, t.requester_user_id from tickets t
        where t.approval_status = 'pending' and t.created_at < now() - interval '2 minutes'
          and not exists (select 1 from approvals a where a.ticket_id = t.id and a.status = 'pending') limit 50`,
    ),
  );
  for (const t of r.rows) {
    try {
      const p = await asSystem((tx) => loadPrincipal(tx, t.requester_user_id));
      if (p) await startApprovals(t.id, p);
    } catch (err) {
      log.error("approvals.repair_failed", { ticketId: t.id, error: errorSummary(err) });
    }
  }
}

// ---------------------------------------------------------------- deciding

export const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(2000).optional(),
  /** Which approval to decide, when the person is asked more than once on a step. */
  approvalId: z.uuid().optional(),
});

export async function decideApproval(p: Principal, ticketId: string, raw: unknown, via: "portal" | "email" = "portal") {
  const input = decisionSchema.parse(raw);
  if (input.decision === "rejected" && !input.note) throw new AppError(422, "validation_failed", "Say why, so the requester knows what to do next.", { field: "note" });
  return asSystem(async (tx) => {
    const t = (
      await tx.query<{ id: string; customer_id: string; requester_user_id: string; approval_status: string }>(
        "select id, customer_id, requester_user_id, approval_status from tickets where id = $1 for update",
        [ticketId],
      )
    ).rows[0];
    if (!t || !p.memberships.some((m) => m.customerId === t.customer_id)) throw notFound("Ticket");
    const pending = (await slotsOf(tx, ticketId)).filter((r) => r.status === "pending");
    const pick = await decidableSlot(tx, p, pending, input.approvalId);
    if (!pick) {
      // System context skips RLS, so keep hiding the request from members who couldn't open it.
      const canOpen = canSeeOrgFor(p, t.customer_id) || t.requester_user_id === p.userId || p.approverFor.includes(t.customer_id);
      if (!canOpen) throw notFound("Ticket");
      if (t.approval_status !== "pending" || !pending.length) throw new AppError(409, "invalid_transition", "This request isn't waiting for approval.");
      throw forbidden("You're not one of the approvers for this step.");
    }
    const { row, onBehalfOf } = pick;
    await tx.query(
      "update approvals set status = $2, decided_by = $3, decided_at = now(), note = $4, on_behalf_of = $5, decided_via = $6 where id = $1",
      [row.id, input.decision, p.userId, input.note ?? null, onBehalfOf, via],
    );
    const stepLabel = row.step_name && row.step_name !== "Approval" ? row.step_name : null;
    await tx.query("insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, to_value) values ($1, $2, $3, $4, $5)", [
      ticketId, t.customer_id, p.userId, input.decision, stepLabel ?? (input.note ? "with a note" : null),
    ]);
    if (input.note) {
      await tx.query("insert into ticket_messages (ticket_id, customer_id, author_user_id, visibility, body, source) values ($1, $2, $3, 'public', $4, $5)", [
        ticketId, t.customer_id, p.userId, `${input.decision === "approved" ? "Approved" : "Not approved"}${stepLabel ? ` (${stepLabel})` : ""}: ${input.note}`, via,
      ]);
    }
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'ticket.approval', 'ticket', $3, $4)",
      [p.userId, t.customer_id, ticketId, JSON.stringify({ decision: input.decision, step: row.step_index, onBehalfOf, via })],
    );
    if (input.decision === "rejected") {
      await tx.query("update approvals set status = 'cancelled' where ticket_id = $1 and status = 'pending'", [ticketId]);
      await cancelHardwareOrder(tx, ticketId);
      await tx.query(
        "update tickets set approval_status = 'rejected', status = 'resolved', resolved_at = now(), resolution_note = $2, updated_at = now(), version = version + 1 where id = $1",
        [ticketId, `Not approved: ${input.note}`],
      );
      await enqueue(tx, "notify.ticket", t.customer_id, { ticketId, event: "approval_decided", actorUserId: p.userId, detail: "rejected", ref: null });
      return { approvalStatus: "rejected" as const };
    }
    const status = await progress(tx, ticketId, p);
    return { approvalStatus: (status ?? "pending") as "pending" | "approved" };
  });
}

/**
 * Replies to approval emails. Deliberately strict, because a chatty reply must
 * never decide anything: approving takes a first line that is only the word
 * (or "approve: note"); rejecting takes the word first, then the reason, and
 * no question mark. Anything else goes to a person to review.
 */
export function parseEmailDecision(body: string): { decision: "approved" | "rejected"; note?: string } | null {
  const lines = body.trim().split(/\r?\n/);
  const first = lines[0].trim();
  if (/^(approve|approved|yes|ok|okay)\s*[.!]*$/i.test(first)) return { decision: "approved" };
  const noted = /^(?:approve|approved)\s*[:–—-]\s*(.+)$/i.exec(first);
  if (noted) return { decision: "approved", note: noted[1].trim().slice(0, 2000) };
  if (first.includes("?")) return null;
  const no = /^(?:reject|rejected|decline|declined|deny|denied)\b\s*[.!:,–—-]*\s*(.*)$/i.exec(first);
  if (!no) return null;
  const note = [no[1], ...lines.slice(1)].join("\n").trim().slice(0, 2000);
  return { decision: "rejected", ...(note ? { note } : {}) };
}

// ---------------------------------------------------------------- what to show

/** Whether this person can decide now, and for whom (system context: delegations are private). */
export async function myApprovalTurn(p: Principal, ticketId: string): Promise<{ approvalId: string; onBehalfOfName: string | null } | null> {
  return asSystem(async (tx) => {
    const pending = (await slotsOf(tx, ticketId)).filter((r) => r.status === "pending");
    const pick = await decidableSlot(tx, p, pending);
    if (!pick) return null;
    const name = pick.onBehalfOf ? (await tx.query<{ display_name: string }>("select display_name from users where id = $1", [pick.onBehalfOf])).rows[0]?.display_name : null;
    return { approvalId: pick.row.id, onBehalfOfName: name ?? null };
  });
}

/** Requests waiting for this person's decision (including for people they stand in for). */
export async function pendingApprovals(p: Principal) {
  const mine = p.memberships.map((m) => m.customerId);
  if (!mine.length) return [];
  return asSystem(async (tx) => {
    const r = await tx.query<{ ticket_id: string; number: string; title: string; name: string; display_name: string; created_at: Date | string; step_name: string | null }>(
      `select distinct on (t.id) t.id as ticket_id, t.number, t.title, c.name, u.display_name, a.created_at, a.step_name
         from approvals a join tickets t on t.id = a.ticket_id join customers c on c.id = t.customer_id join users u on u.id = t.requester_user_id
        where a.status = 'pending' and a.customer_id = any($1::uuid[]) order by t.id, a.created_at`,
      [mine],
    );
    const out = [];
    for (const x of r.rows) {
      const pending = (await slotsOf(tx, x.ticket_id)).filter((s) => s.status === "pending");
      if (await decidableSlot(tx, p, pending)) {
        out.push({
          ticketId: x.ticket_id,
          number: Number(x.number),
          title: x.title,
          customerName: x.name,
          requesterName: x.display_name,
          requestedAt: new Date(x.created_at).toISOString(),
          stepName: x.step_name && x.step_name !== "Approval" ? x.step_name : null,
        });
      }
    }
    return out.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  });
}

// ---------------------------------------------------------------- delegation

const realDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Choose a date." })
  .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, { error: "That date doesn't exist." });
const delegationSchema = z.object({
  delegateUserId: z.uuid({ error: "Choose who decides for you." }),
  startsOn: realDate,
  endsOn: realDate,
});

export interface Delegation {
  id: string;
  delegateUserId: string;
  delegateName: string;
  startsOn: string;
  endsOn: string;
}

/** People who could stand in: active members of a company this person approves for. */
export async function delegationOptions(p: Principal) {
  const companies = p.memberships.filter((m) => m.role === "client_admin" || m.role === "service_manager" || p.approverFor.includes(m.customerId)).map((m) => m.customerId);
  if (!companies.length) return { canDelegate: false, people: [] as { id: string; name: string }[], delegations: [] as Delegation[] };
  return asSystem(async (tx) => {
    const people = await tx.query<{ id: string; name: string }>(
      `select distinct u.id, u.display_name as name from memberships m join users u on u.id = m.user_id
        where m.customer_id = any($1::uuid[]) and m.revoked_at is null and u.status = 'active' and not u.is_system and u.id <> $2 order by u.display_name`,
      [companies, p.userId],
    );
    const d = await tx.query<{ id: string; delegate_user_id: string; name: string; starts_on: string; ends_on: string }>(
      `select d.id, d.delegate_user_id, u.display_name as name, d.starts_on::text, d.ends_on::text from approval_delegations d join users u on u.id = d.delegate_user_id
        where d.user_id = $1 and d.ends_on >= (now() at time zone 'America/Los_Angeles')::date order by d.starts_on`,
      [p.userId],
    );
    return {
      canDelegate: true,
      people: people.rows,
      delegations: d.rows.map((r) => ({ id: r.id, delegateUserId: r.delegate_user_id, delegateName: r.name, startsOn: r.starts_on, endsOn: r.ends_on })),
    };
  });
}

export async function addDelegation(p: Principal, raw: unknown) {
  const v = delegationSchema.parse(raw);
  if (v.endsOn < v.startsOn) throw new AppError(422, "validation_failed", "The end date is before the start date.", { field: "endsOn" });
  const opts = await delegationOptions(p);
  if (!opts.canDelegate) throw forbidden("Only approvers can delegate approvals.");
  if (!opts.people.some((x) => x.id === v.delegateUserId)) throw new AppError(422, "validation_failed", "Choose someone from your organization.", { field: "delegateUserId" });
  return asSystem(async (tx) => {
    const r = await tx.query<{ id: string }>(
      "insert into approval_delegations (user_id, delegate_user_id, starts_on, ends_on) values ($1, $2, $3, $4) returning id",
      [p.userId, v.delegateUserId, v.startsOn, v.endsOn],
    );
    await tx.query(
      "insert into audit_events (actor_user_id, action, target_type, target_id, details) values ($1, 'approval.delegate', 'user', $2, $3)",
      [p.userId, v.delegateUserId, JSON.stringify({ startsOn: v.startsOn, endsOn: v.endsOn })],
    );
    return { id: r.rows[0].id };
  });
}

export async function removeDelegation(p: Principal, id: string) {
  return asSystem(async (tx) => {
    const r = await tx.query("delete from approval_delegations where id = $1 and user_id = $2 returning id", [id, p.userId]);
    if (!r.rows[0]) throw notFound("Delegation");
    await tx.query("insert into audit_events (actor_user_id, action, target_type, target_id, details) values ($1, 'approval.delegate_removed', 'approval_delegation', $2, '{}')", [p.userId, id]);
    return { ok: true };
  });
}


/** Operator: people who can be named as approvers in a workflow (active members of each company). */
export async function approverCandidates(p: Principal) {
  if (!p.isOperator) throw forbidden("Only platform operators can edit workflows.");
  return asSystem(async (tx) =>
    (
      await tx.query<{ id: string; name: string; customer_id: string; customer_name: string }>(
        `select u.id, u.display_name as name, m.customer_id, c.name as customer_name
           from memberships m join users u on u.id = m.user_id join customers c on c.id = m.customer_id
          where m.revoked_at is null and u.status = 'active' and not u.is_system and c.status = 'active'
          order by c.name, u.display_name`,
      )
    ).rows.map((r) => ({ id: r.id, name: r.name, customerId: r.customer_id, customerName: r.customer_name })),
  );
}
