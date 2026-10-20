import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { listCustomersForOperator } from "@/lib/admin/service";
import { listSlaPolicies } from "@/lib/sla/admin";
import { PageTransition } from "@/components/page-transition";
import { IconBack } from "@/components/icons";
import { SlaConsole } from "./console";

export const metadata = { title: "Service levels" };

export default async function SlaPage() {
  const { principal } = await requirePrincipal("/portal/admin/sla");
  if (!principal.isOperator) {
    return (
      <PageTransition>
        <h1>Service levels</h1>
        <p className="muted">Only platform operators can manage service levels.</p>
      </PageTransition>
    );
  }
  const [policies, customers] = await Promise.all([listSlaPolicies(principal), listCustomersForOperator(principal)]);
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
          <h1>Service levels</h1>
        </div>
      </div>
      <p className="subtle">
        Targets are in business time on each policy&apos;s calendar. The resolution clock pauses while a ticket waits on the customer or is resolved.
        Only technicians see targets; customers never do. New tickets use the policy their customer has when they&apos;re created.
      </p>
      <SlaConsole
        policies={policies}
        customers={(customers as { id: string; name: string; status: string; sla_policy_id: string | null }[]).map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          policyId: c.sla_policy_id,
        }))}
      />
    </PageTransition>
  );
}
