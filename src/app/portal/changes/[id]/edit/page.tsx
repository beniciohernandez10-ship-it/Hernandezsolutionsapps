import { notFound } from "next/navigation";
import { requirePrincipal } from "@/lib/auth/current";
import { getChange } from "@/lib/changes/service";
import { staffPickers } from "@/lib/changes/staff";
import { AppError } from "@/lib/errors";
import { PageTransition } from "@/components/page-transition";
import { ChangeForm } from "../../form";

export const metadata = { title: "Edit change" };

export default async function EditChangePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { principal } = await requirePrincipal(`/portal/changes/${id}/edit`);
  let c;
  try {
    c = await getChange(principal, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  if (!c.viewer.canEdit) notFound();
  const { customers, staffByCustomer } = await staffPickers(principal);
  return (
    <PageTransition>
      <div className="page-head">
        <h1>Edit CHG-{c.number}</h1>
      </div>
      {c.status === "scheduled" && c.changeType !== "standard" && (
        <p className="alert alert-warning">
          <span>Saving sends this change back to draft so it can be approved again.</span>
        </p>
      )}
      <ChangeForm
        customers={customers}
        staffByCustomer={staffByCustomer}
        initial={{ id: c.id, customerId: c.customerId, title: c.title, description: c.description, changeType: c.changeType, risk: c.risk, impact: c.impact, implementationPlan: c.implementationPlan, backoutPlan: c.backoutPlan, plannedStart: c.plannedStart, plannedEnd: c.plannedEnd, notifyCustomer: c.notifyCustomer, implementerUserId: c.implementerUserId }}
      />
    </PageTransition>
  );
}
