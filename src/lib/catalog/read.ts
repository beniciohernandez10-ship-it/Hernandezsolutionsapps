import type { Queryable } from "../db";
import { roleFor, type Principal } from "../authz";
import type { ApprovalStep } from "./workflow";

/** Read helpers for catalog requests, used by the ticket view and the catalog service. */

/** Who may approve planned changes for a customer: its client admins, or its service managers if it has none. */
export async function approverRole(tx: Queryable, customerId: string): Promise<"client_admin" | "service_manager"> {
  // Works for every member, including requesters who can't list other members (see 0005).
  const r = await tx.query<{ yes: boolean }>("select app_customer_has_client_admin($1) as yes", [customerId]);
  return r.rows[0]?.yes ? "client_admin" : "service_manager";
}

/**
 * Who approves catalog requests for a company: its named approvers; if it has
 * none, its client admins; if it has none of those either, Hernandez Solutions.
 * Service managers can always approve. Same rule as app_can_approve (0019).
 */
export type RequestApprovers = { mode: "named"; names: string[] } | { mode: "client_admin" } | { mode: "service_manager" };

export async function requestApprovers(tx: Queryable, customerId: string): Promise<RequestApprovers> {
  const r = await tx.query<{ named: boolean; admin: boolean }>(
    "select app_customer_has_approvers($1) as named, app_customer_has_client_admin($1) as admin",
    [customerId],
  );
  if (r.rows[0]?.named) {
    const n = await tx.query<{ name: string }>("select app_request_approver_names($1) as name", [customerId]);
    return { mode: "named", names: n.rows.map((x) => x.name) };
  }
  return { mode: r.rows[0]?.admin ? "client_admin" : "service_manager" };
}

export function canApproveRequest(p: Principal, customerId: string, a: RequestApprovers) {
  const role = roleFor(p, customerId);
  if (role === "service_manager") return true;
  if (a.mode === "named") return (p.approverFor ?? []).includes(customerId);
  return a.mode === "client_admin" && role === "client_admin";
}

/** One approver slot on a ticket's approval step. */
export type SlotRow = Record<string, unknown> & {
  id: string;
  ticket_id: string;
  customer_id: string;
  requested_by: string;
  status: string;
  step_index: number;
  step_name: string | null;
  step_mode: "any" | "all";
  slot: number;
  approver_kind: "default" | "role" | "user";
  approver_role: "client_admin" | "service_manager" | null;
  approver_user_id: string | null;
  approver_label: string | null;
  notified_at: string | null;
};

export function canDecideSlot(p: Principal, row: SlotRow, defaults: RequestApprovers) {
  const role = roleFor(p, row.customer_id);
  if (!role) return false;
  if (role === "service_manager") return true;
  if (row.approver_kind === "user") return row.approver_user_id === p.userId;
  if (row.approver_kind === "role") return role === row.approver_role;
  return canApproveRequest(p, row.customer_id, defaults);
}

const approverLabel = (a: RequestApprovers) =>
  a.mode === "named" ? a.names.join(" or ") : a.mode === "client_admin" ? "your organization's administrator" : "Hernandez Solutions";

export interface TicketTask {
  id: string;
  title: string;
  done: boolean;
  doneAt: string | null;
  doneByName: string | null;
}

export async function listTasks(tx: Queryable, ticketId: string): Promise<TicketTask[]> {
  const r = await tx.query(
    `select k.id, k.title, k.done_at, u.display_name from ticket_tasks k left join users u on u.id = k.done_by
      where k.ticket_id = $1 order by k.position, k.created_at`,
    [ticketId],
  );
  return r.rows.map((x) => ({
    id: x.id as string,
    title: x.title as string,
    done: Boolean(x.done_at),
    doneAt: x.done_at ? new Date(x.done_at as string).toISOString() : null,
    doneByName: (x.display_name as string) ?? null,
  }));
}

export interface ApprovalInfo {
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  note: string | null;
  /** This viewer can decide directly. The page adds standing in for someone (delegations are private): see myApprovalTurn. */
  canDecide: boolean;
  /** The approval this viewer would decide, and for whom if they stand in for someone. */
  approvalId?: string;
  onBehalfOfName?: string | null;
  approverLabel: string;
  steps: ApprovalStepView[];
}

export interface ApprovalStepView {
  index: number;
  name: string;
  mode: "any" | "all";
  state: "done" | "current" | "upcoming" | "rejected";
  slots: { id: string; label: string; status: "pending" | "approved" | "rejected" | "cancelled"; decidedBy: string | null; onBehalfOf: string | null; via: string | null; note: string | null }[];
}

/** The plan with every step's progress, readable by anyone who can see the ticket. */
export async function approvalSteps(tx: Queryable, ticketId: string, plan: Pick<ApprovalStep, "name" | "mode">[] | null): Promise<ApprovalStepView[]> {
  const rows = await tx.query<Record<string, unknown>>(
    `select a.id, a.step_index, a.step_name, a.step_mode, a.status, a.approver_label, a.note, a.decided_via, d.display_name as decided_by, b.display_name as on_behalf_of
       from approvals a left join users d on d.id = a.decided_by left join users b on b.id = a.on_behalf_of
      where a.ticket_id = $1 order by a.step_index, a.slot`,
    [ticketId],
  );
  const steps = plan?.length ? plan : [{ name: "Approval", mode: "any" as const }];
  const rejectedAt = rows.rows.find((r) => r.status === "rejected")?.step_index as number | undefined;
  return steps.map((s, index) => {
    const mine = rows.rows.filter((r) => Number(r.step_index) === index);
    const state: ApprovalStepView["state"] =
      rejectedAt === index ? "rejected" : !mine.length ? "upcoming" : mine.some((r) => r.status === "pending") ? "current" : "done";
    return {
      index,
      name: s.name,
      mode: s.mode,
      state,
      slots: mine.map((r) => ({
        id: String(r.id),
        label: String(r.approver_label ?? "the usual approvers"),
        status: r.status as ApprovalStepView["slots"][number]["status"],
        decidedBy: (r.decided_by as string) ?? null,
        onBehalfOf: (r.on_behalf_of as string) ?? null,
        via: (r.decided_via as string) ?? null,
        note: (r.note as string) ?? null,
      })),
    };
  });
}

export async function approvalFor(tx: Queryable, p: Principal, ticketId: string, customerId: string): Promise<ApprovalInfo | null> {
  const t = await tx.query<{ approval_status: string; approval_plan: Pick<ApprovalStep, "name" | "mode">[] | null }>(
    "select approval_status, approval_plan from tickets where id = $1",
    [ticketId],
  );
  const r = await tx.query(
    `select a.status, a.created_at, a.decided_at, a.note, a.approver_label, u.display_name from approvals a left join users u on u.id = a.decided_by
      where a.ticket_id = $1 and a.status <> 'cancelled' order by a.decided_at desc nulls last, a.created_at desc`,
    [ticketId],
  );
  if (!r.rows.length || !t.rows[0] || t.rows[0].approval_status === "not_required") return null;
  const status = t.rows[0].approval_status as ApprovalInfo["status"];
  const first = await tx.query<{ created_at: string }>("select min(created_at) as created_at from approvals where ticket_id = $1", [ticketId]);
  const last = r.rows.find((a) => a.decided_at) ?? r.rows[0];
  const steps = await approvalSteps(tx, ticketId, t.rows[0].approval_plan);
  const currentStep = steps.find((s) => s.state === "current");
  const waitingOn = [...new Set(currentStep?.slots.filter((s) => s.status === "pending").map((s) => s.label) ?? [])];
  const approvers = await requestApprovers(tx, customerId);
  const pending = await tx.query<SlotRow>("select * from approvals where ticket_id = $1 and status = 'pending'", [ticketId]);
  return {
    status,
    requestedAt: new Date(first.rows[0].created_at).toISOString(),
    decidedByName: status === "pending" ? null : ((last.display_name as string) ?? null),
    decidedAt: status !== "pending" && last.decided_at ? new Date(last.decided_at as string).toISOString() : null,
    note: status === "pending" ? null : ((last.note as string) ?? null),
    canDecide: pending.rows.some((row) => canDecideSlot(p, row, approvers)),
    approverLabel: waitingOn.length ? waitingOn.join(currentStep?.mode === "all" ? " and " : " or ") : approverLabel(approvers),
    steps,
  };
}

