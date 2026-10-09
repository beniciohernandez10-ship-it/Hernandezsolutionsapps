import { requirePrincipal } from "@/lib/auth/current";
import { canSeeOrgFor } from "@/lib/authz";
import { listDevices } from "@/lib/tickets/service";
import { PageTransition } from "@/components/page-transition";
import { NewTicketForm } from "./form";

export const metadata = { title: "New request" };

export default async function NewTicketPage() {
  const { principal } = await requirePrincipal("/portal/tickets/new");
  const orgs = principal.memberships.map((m) => ({ id: m.customerId, name: m.customerName }));
  const deviceCustomers = principal.memberships.filter((m) => canSeeOrgFor(principal, m.customerId));
  const devices = deviceCustomers.length ? (await listDevices(principal)).devices.map((d) => ({ id: d.id, name: d.name, customerId: d.customerId })) : [];
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">New request</p>
          <h1>How can we help?</h1>
        </div>
      </div>
      {orgs.length === 0 ? (
        <p className="muted">Your account isn&apos;t assigned to an organization, so you can&apos;t submit requests yet.</p>
      ) : (
        <NewTicketForm orgs={orgs} devices={devices} />
      )}
    </PageTransition>
  );
}
