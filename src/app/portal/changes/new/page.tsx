import { requirePrincipal } from "@/lib/auth/current";
import { staffPickers } from "@/lib/changes/staff";
import { PageTransition } from "@/components/page-transition";
import { ChangeForm } from "../form";

export const metadata = { title: "Plan a change" };

export default async function NewChangePage() {
  const { principal } = await requirePrincipal("/portal/changes/new");
  const { customers, staffByCustomer } = await staffPickers(principal);
  if (!customers.length) {
    return (
      <PageTransition>
        <h1>Plan a change</h1>
        <p className="muted">Only technicians can plan changes.</p>
      </PageTransition>
    );
  }
  return (
    <PageTransition>
      <div className="page-head">
        <h1>Plan a change</h1>
      </div>
      <ChangeForm
        customers={customers}
        staffByCustomer={staffByCustomer}
        initial={{ id: null, customerId: customers[0].id, title: "", description: "", changeType: "normal", risk: "low", impact: "", implementationPlan: "", backoutPlan: "", plannedStart: null, plannedEnd: null, notifyCustomer: true, implementerUserId: null }}
      />
    </PageTransition>
  );
}
