import type { Queryable } from "./db";
import { forbidden } from "./errors";

export type Role = "requester" | "client_admin" | "technician" | "service_manager";
export const STAFF_ROLES: readonly Role[] = ["technician", "service_manager"];
export const ORG_ROLES: readonly Role[] = ["client_admin", "technician", "service_manager"];

export interface Membership {
  customerId: string;
  customerName: string;
  role: Role;
}

/**
 * The authenticated actor for one request, loaded from the database on every
 * request so membership revocation and user disablement apply immediately.
 * Nothing here comes from the browser.
 */
export interface Principal {
  userId: string;
  email: string;
  displayName: string;
  isOperator: boolean;
  memberships: Membership[];
  sessionAuthTime?: Date;
}

export async function loadPrincipal(tx: Queryable, userId: string): Promise<Principal | null> {
  const u = await tx.query<{ id: string; email: string; display_name: string; is_platform_operator: boolean }>(
    "select id, email, display_name, is_platform_operator from users where id = $1 and status = 'active'",
    [userId],
  );
  if (!u.rows[0]) return null;
  const m = await tx.query<{ customer_id: string; name: string; role: Role }>(
    `select m.customer_id, c.name, m.role
       from memberships m join customers c on c.id = m.customer_id
      where m.user_id = $1 and m.revoked_at is null and c.status <> 'offboarded'
      order by c.name`,
    [userId],
  );
  return {
    userId: u.rows[0].id,
    email: u.rows[0].email,
    displayName: u.rows[0].display_name,
    isOperator: u.rows[0].is_platform_operator,
    memberships: m.rows.map((r) => ({ customerId: r.customer_id, customerName: r.name, role: r.role })),
  };
}

export function roleFor(p: Principal, customerId: string): Role | undefined {
  return p.memberships.find((m) => m.customerId === customerId)?.role;
}

export const isStaffFor = (p: Principal, customerId: string) => STAFF_ROLES.includes(roleFor(p, customerId) as Role);
export const canSeeOrgFor = (p: Principal, customerId: string) => ORG_ROLES.includes(roleFor(p, customerId) as Role);
export const isStaffAnywhere = (p: Principal) => p.memberships.some((m) => STAFF_ROLES.includes(m.role));
export const isManagerAnywhere = (p: Principal) => p.memberships.some((m) => m.role === "service_manager");

export function customersWhere(p: Principal, pred: (r: Role) => boolean) {
  return p.memberships.filter((m) => pred(m.role)).map((m) => m.customerId);
}

export function requireMember(p: Principal, customerId: string): Role {
  const r = roleFor(p, customerId);
  if (!r) throw forbidden();
  return r;
}

export function requireStaff(p: Principal, customerId: string) {
  if (!isStaffFor(p, customerId)) throw forbidden("Only assigned technicians can do that.");
}

export function requireOperator(p: Principal) {
  if (!p.isOperator) throw forbidden("Only platform operators can do that.");
}

/** Plain-language capabilities for the UI. Display only; the server re-checks every action. */
export function capabilities(p: Principal) {
  return {
    staff: isStaffAnywhere(p),
    manager: isManagerAnywhere(p),
    operator: p.isOperator,
    orgView: p.memberships.some((m) => ORG_ROLES.includes(m.role)),
    canCreate: p.memberships.length > 0,
  };
}
