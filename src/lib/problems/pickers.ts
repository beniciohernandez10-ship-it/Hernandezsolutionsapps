import { STAFF_ROLES, type Principal } from "../authz";
import { asSystem } from "../db";

/** Customers the technician serves, and every active technician of those customers (owner picker). */
export async function problemPickers(p: Principal) {
  const customers = p.memberships.filter((m) => STAFF_ROLES.includes(m.role)).map((m) => ({ id: m.customerId, name: m.customerName }));
  const staff = await asSystem(async (tx) =>
    (
      await tx.query<{ id: string; display_name: string }>(
        `select distinct u.id, u.display_name from memberships m join users u on u.id = m.user_id
          where m.customer_id = any($1::uuid[]) and m.revoked_at is null and m.role in ('technician', 'service_manager') and u.status = 'active'
          order by u.display_name`,
        [customers.map((c) => c.id)],
      )
    ).rows.map((r) => ({ id: r.id, name: r.display_name })),
  );
  return { customers, staff };
}
