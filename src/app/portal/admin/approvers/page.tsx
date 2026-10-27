import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { listApproverSetup } from "@/lib/catalog/approvers";
import { PageTransition } from "@/components/page-transition";
import { IconBack } from "@/components/icons";
import { ApproversConsole } from "./console";

export const metadata = { title: "Approvers" };

export default async function ApproversPage() {
  const { principal } = await requirePrincipal("/portal/admin/approvers");
  if (!principal.isOperator) {
    return (
      <PageTransition>
        <h1>Approvers</h1>
        <p className="muted">Only platform operators can choose approvers.</p>
      </PageTransition>
    );
  }
  const companies = await listApproverSetup(principal);
  return (
    <PageTransition>
      <p>
        <Link href="/portal/admin" transitionTypes={["nav-back"]} className="subtle">
          <IconBack size={14} /> Administration
        </Link>
      </p>
      <div className="page-head">
        <div>
          <p className="eyebrow">Platform operator</p>
          <h1>Approvers</h1>
        </div>
      </div>
      <p className="subtle">
        Approvers sign off requests that need approval, such as new hardware, before anything is ordered. Pick people at each company (for
        example its office manager). If a company has none, its client administrators approve. Hernandez Solutions service managers can always
        approve. Approvers see the requests waiting for them, not the rest of their company&apos;s tickets.
      </p>
      <ApproversConsole companies={companies} />
    </PageTransition>
  );
}
