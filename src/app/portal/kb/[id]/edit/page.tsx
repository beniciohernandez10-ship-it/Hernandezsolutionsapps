import { notFound } from "next/navigation";
import { requirePrincipal } from "@/lib/auth/current";
import { STAFF_ROLES } from "@/lib/authz";
import { getArticle } from "@/lib/kb/service";
import { AppError } from "@/lib/errors";
import { PageTransition } from "@/components/page-transition";
import { ArticleEditor } from "../../editor";

export const metadata = { title: "Edit article" };

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { principal } = await requirePrincipal(`/portal/kb/${id}/edit`);
  let a;
  try {
    a = await getArticle(principal, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  if (!a.canEdit) notFound();
  const customers = principal.memberships.filter((m) => STAFF_ROLES.includes(m.role)).map((m) => ({ id: m.customerId, name: m.customerName }));
  return (
    <PageTransition>
      <div className="page-head">
        <h1>Edit article</h1>
      </div>
      <ArticleEditor
        canGlobal
        customers={customers}
        initial={{ id: a.id, title: a.title, summary: a.summary, body: a.body, category: a.category, audience: a.audience, customerId: a.customerId, status: a.status }}
      />
    </PageTransition>
  );
}
