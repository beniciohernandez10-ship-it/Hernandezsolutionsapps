import { requirePrincipal } from "@/lib/auth/current";
import { isStaffAnywhere, STAFF_ROLES } from "@/lib/authz";
import { PageTransition } from "@/components/page-transition";
import { ArticleEditor } from "../editor";

export const metadata = { title: "New article" };

export default async function NewArticlePage() {
  const { principal } = await requirePrincipal("/portal/kb/new");
  if (!isStaffAnywhere(principal)) {
    return (
      <PageTransition>
        <h1>New article</h1>
        <p className="muted">Only technicians can write articles.</p>
      </PageTransition>
    );
  }
  const customers = principal.memberships.filter((m) => STAFF_ROLES.includes(m.role)).map((m) => ({ id: m.customerId, name: m.customerName }));
  return (
    <PageTransition>
      <div className="page-head">
        <h1>New article</h1>
      </div>
      <ArticleEditor
        canGlobal
        customers={customers}
        initial={{ id: null, title: "", summary: "", body: "", category: "general", audience: "everyone", customerId: null, status: "draft" }}
      />
    </PageTransition>
  );
}
