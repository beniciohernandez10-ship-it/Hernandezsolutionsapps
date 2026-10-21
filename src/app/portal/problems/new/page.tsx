import { requirePrincipal } from "@/lib/auth/current";
import { isStaffAnywhere } from "@/lib/authz";
import { problemPickers } from "@/lib/problems/pickers";
import { PageTransition } from "@/components/page-transition";
import { ProblemEditor } from "../editor";

export const metadata = { title: "Record a problem" };

export default async function NewProblemPage() {
  const { principal } = await requirePrincipal("/portal/problems/new");
  if (!isStaffAnywhere(principal)) {
    return (
      <PageTransition>
        <h1>Record a problem</h1>
        <p className="muted">Problem management is for technicians.</p>
      </PageTransition>
    );
  }
  const { customers, staff } = await problemPickers(principal);
  return (
    <PageTransition>
      <div className="page-head">
        <h1>Record a problem</h1>
      </div>
      <ProblemEditor
        customers={customers}
        staff={staff}
        initial={{ id: null, customerId: customers.length === 1 ? customers[0].id : null, title: "", description: "", status: "investigating", rootCause: "", workaround: "", permanentFix: "", ownerUserId: principal.userId }}
      />
    </PageTransition>
  );
}
