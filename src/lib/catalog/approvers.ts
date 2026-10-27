import { z } from "zod";
import { asSystem } from "../db";
import { requireOperator, ROLE_LABEL, type Principal, type Role } from "../authz";
import { AppError, notFound } from "../errors";

/**
 * Named approvers per company (platform operators). Approvers decide catalog
 * requests such as new hardware; a company with none falls back to its client
 * administrators. Approvers must be active members of that company.
 */

export interface ApproverPerson {
  userId: string;
  name: string;
  email: string;
  role: string;
}

export interface CompanyApprovers {
  customerId: string;
  customerName: string;
  approvers: ApproverPerson[];
  /** Active members who could be added. */
  members: ApproverPerson[];
  /** Who approves today if no one is named. */
  fallback: "client_admin" | "service_manager";
}

export async function listApproverSetup(p: Principal): Promise<CompanyApprovers[]> {
  requireOperator(p);
  return asSystem(async (tx) => {
    const customers = await tx.query<{ id: string; name: string }>("select id, name from customers where status <> 'offboarded' order by name");
    const members = await tx.query<{ customer_id: string; user_id: string; display_name: string; email: string; role: Role; approver: boolean }>(
      `select m.customer_id, u.id as user_id, u.display_name, u.email, m.role,
              exists (select 1 from customer_approvers a where a.customer_id = m.customer_id and a.user_id = u.id) as approver
         from memberships m join users u on u.id = m.user_id
        where m.revoked_at is null and u.status = 'active' order by u.display_name`,
    );
    return customers.rows.map((c) => {
      const mine = members.rows.filter((m) => m.customer_id === c.id);
      const person = (m: (typeof mine)[number]) => ({ userId: m.user_id, name: m.display_name, email: m.email, role: ROLE_LABEL[m.role] ?? m.role });
      return {
        customerId: c.id,
        customerName: c.name,
        approvers: mine.filter((m) => m.approver).map(person),
        members: mine.filter((m) => !m.approver).map(person),
        fallback: mine.some((m) => m.role === "client_admin") ? "client_admin" : "service_manager",
      };
    });
  });
}

const target = z.object({ customerId: z.uuid(), userId: z.uuid() });

export async function addApprover(p: Principal, raw: unknown) {
  requireOperator(p);
  const v = target.parse(raw);
  return asSystem(async (tx) => {
    const member = await tx.query(
      `select 1 from memberships m join users u on u.id = m.user_id
        where m.customer_id = $1 and m.user_id = $2 and m.revoked_at is null and u.status = 'active'`,
      [v.customerId, v.userId],
    );
    if (!member.rows[0]) throw new AppError(422, "validation_failed", "Approvers must be active members of that company.", { field: "userId" });
    await tx.query("insert into customer_approvers (customer_id, user_id, added_by) values ($1, $2, $3) on conflict do nothing", [v.customerId, v.userId, p.userId]);
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'approver.add', 'user', $3, '{}')",
      [p.userId, v.customerId, v.userId],
    );
    return { ok: true };
  });
}

export async function removeApprover(p: Principal, raw: unknown) {
  requireOperator(p);
  const v = target.parse(raw);
  return asSystem(async (tx) => {
    const r = await tx.query("delete from customer_approvers where customer_id = $1 and user_id = $2", [v.customerId, v.userId]);
    if (!r.rowCount) throw notFound("Approver");
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'approver.remove', 'user', $3, '{}')",
      [p.userId, v.customerId, v.userId],
    );
    return { ok: true };
  });
}
