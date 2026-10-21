import { requirePrincipal } from "@/lib/auth/current";
import { isStaffAnywhere, STAFF_ROLES } from "@/lib/authz";
import { listCanned } from "@/lib/productivity/service";
import { PageTransition } from "@/components/page-transition";
import { RepliesConsole } from "./console";

export const metadata = { title: "Saved replies" };

export default async function RepliesPage() {
  const { principal } = await requirePrincipal("/portal/replies");
  if (!isStaffAnywhere(principal)) {
    return (
      <PageTransition>
        <h1>Saved replies</h1>
        <p className="muted">Saved replies are for technicians.</p>
      </PageTransition>
    );
  }
  const items = await listCanned(principal);
  const customers = principal.memberships.filter((m) => STAFF_ROLES.includes(m.role)).map((m) => ({ id: m.customerId, name: m.customerName }));
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Technicians</p>
          <h1>Saved replies</h1>
        </div>
      </div>
      <p className="subtle">
        Insert these from the reply box on any ticket. Fill-ins: {"{{requester_first_name}}"}, {"{{requester_name}}"}, {"{{ticket_number}}"},{" "}
        {"{{technician_name}}"}. Shared replies can be edited by every technician.
      </p>
      <RepliesConsole items={items} customers={customers} />
    </PageTransition>
  );
}
