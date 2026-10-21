import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { listCustomersForOperator } from "@/lib/admin/service";
import { listRules, ruleTargets } from "@/lib/productivity/service";
import { PageTransition } from "@/components/page-transition";
import { IconBack } from "@/components/icons";
import { RulesConsole } from "./console";

export const metadata = { title: "Assignment rules" };

export default async function RulesPage() {
  const { principal } = await requirePrincipal("/portal/admin/rules");
  if (!principal.isOperator) {
    return (
      <PageTransition>
        <h1>Assignment rules</h1>
        <p className="muted">Only platform operators can manage assignment rules.</p>
      </PageTransition>
    );
  }
  const [rules, targets, customers] = await Promise.all([listRules(principal), ruleTargets(principal), listCustomersForOperator(principal)]);
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
          <h1>Assignment rules</h1>
        </div>
      </div>
      <p className="subtle">
        New requests that nobody has assigned are given to a technician or queue by the first matching rule. Rules for a specific client are
        checked before rules for all clients, then by order. A rule is skipped if its technician isn&apos;t assigned to the request&apos;s client.
      </p>
      <RulesConsole rules={rules} targets={targets} customers={(customers as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name }))} />
    </PageTransition>
  );
}
