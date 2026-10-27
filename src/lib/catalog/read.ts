import type { Queryable } from "../db";
import { roleFor, type Principal } from "../authz";

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
  canDecide: boolean;
  approverLabel: string;
}

export async function approvalFor(tx: Queryable, p: Principal, ticketId: string, customerId: string): Promise<ApprovalInfo | null> {
  const r = await tx.query(
    `select a.status, a.created_at, a.decided_at, a.note, u.display_name from approvals a left join users u on u.id = a.decided_by
      where a.ticket_id = $1 order by a.created_at desc limit 1`,
    [ticketId],
  );
  const a = r.rows[0];
  if (!a) return null;
  const approvers = await requestApprovers(tx, customerId);
  return {
    status: a.status as ApprovalInfo["status"],
    requestedAt: new Date(a.created_at as string).toISOString(),
    decidedByName: (a.display_name as string) ?? null,
    decidedAt: a.decided_at ? new Date(a.decided_at as string).toISOString() : null,
    note: (a.note as string) ?? null,
    canDecide: a.status === "pending" && canApproveRequest(p, customerId, approvers),
    approverLabel: approverLabel(approvers),
  };
}

