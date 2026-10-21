import type { Principal } from "../authz";
import { STAFF_ROLES } from "../authz";
import { listAssignableStaff } from "../tickets/service";

/** Customers the technician serves, and the technicians of each (for implementer pickers). */
export async function staffPickers(p: Principal) {
  const customers = p.memberships.filter((m) => STAFF_ROLES.includes(m.role)).map((m) => ({ id: m.customerId, name: m.customerName }));
  const staffByCustomer: Record<string, { id: string; name: string }[]> = {};
  for (const c of customers) staffByCustomer[c.id] = (await listAssignableStaff(p, c.id)).map((s) => ({ id: s.id, name: s.name }));
  return { customers, staffByCustomer };
}
