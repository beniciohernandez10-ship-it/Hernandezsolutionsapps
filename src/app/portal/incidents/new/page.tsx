import { requirePrincipal } from "@/lib/auth/current";
import { STAFF_ROLES } from "@/lib/authz";
import { PageTransition } from "@/components/page-transition";
import { DeclareForm } from "./form";

export const metadata = { title: "Declare an incident" };

export default async function NewIncidentPage() {
  const { principal } = await requirePrincipal("/portal/incidents/new");
  if (!principal.memberships.some((m) => m.role === "service_manager")) {
    return (
      <PageTransition>
        <h1>Declare an incident</h1>
        <p className="muted">Only service managers can declare incidents.</p>
      </PageTransition>
    );
  }
  const customers = principal.memberships.filter((m) => STAFF_ROLES.includes(m.role)).map((m) => ({ id: m.customerId, name: m.customerName }));
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Service managers</p>
          <h1>Declare an incident</h1>
        </div>
      </div>
      <p className="subtle">For problems affecting many people at once, such as an outage. Everyone at the affected clients sees it on the status page and in a banner.</p>
      <DeclareForm customers={customers} />
    </PageTransition>
  );
}
