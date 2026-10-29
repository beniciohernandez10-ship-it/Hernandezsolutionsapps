import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { listAteraConnections, listCustomersForOperator, listMembershipsForOperator } from "@/lib/admin/service";
import { PageTransition } from "@/components/page-transition";
import { AdminConsole } from "./console";
import { aiConfigured } from "@/lib/config";

export const metadata = { title: "Administration" };

export default async function AdminPage() {
  const { principal } = await requirePrincipal("/portal/admin");
  if (!principal.isOperator) {
    return (
      <PageTransition>
        <h1>Administration</h1>
        <p className="muted">Only platform operators can manage customers and memberships.</p>
      </PageTransition>
    );
  }
  const customers = (await listCustomersForOperator(principal)) as {
    id: string; slug: string; name: string; status: string; is_demo: boolean; members: number; ai_enabled: boolean;
    directories: { tenantId: string; name: string; inventory: boolean; consentAt: string | null }[] | null;
    atera: { connection: string; ateraCustomerId: number; verifiedAt: string | null }[] | null;
  }[];
  const memberships = Object.fromEntries(
    await Promise.all(customers.map(async (c) => [c.id, (await listMembershipsForOperator(principal, c.id)) as never] as const)),
  );
  const connections = (await listAteraConnections(principal)) as { id: string; name: string }[];
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Platform operator</p>
          <h1>Administration</h1>
        </div>
        <div className="row">
          <Link className="btn" href="/portal/admin/catalog" transitionTypes={["nav-forward"]}>Service catalog</Link>
          <Link className="btn" href="/portal/admin/sla" transitionTypes={["nav-forward"]}>Service levels</Link>
          <Link className="btn" href="/portal/admin/queues" transitionTypes={["nav-forward"]}>Queues</Link>
          <Link className="btn" href="/portal/admin/approvers" transitionTypes={["nav-forward"]}>Approvers</Link>
          <Link className="btn" href="/portal/admin/billing" transitionTypes={["nav-forward"]}>Billing</Link>
          <Link className="btn" href="/portal/admin/monitoring" transitionTypes={["nav-forward"]}>Monitoring</Link>
          <Link className="btn" href="/portal/admin/rules" transitionTypes={["nav-forward"]}>Assignment rules</Link>
          <Link className="btn" href="/portal/admin/reports" transitionTypes={["nav-forward"]}>Monthly reports</Link>
          <Link className="btn" href="/portal/admin/audit" transitionTypes={["nav-forward"]}>Audit log</Link>
        </div>
      </div>
      <p className="subtle">Changes here are audited. Sensitive changes ask you to sign in again if your last sign-in was a while ago.</p>
      <AdminConsole customers={customers} memberships={memberships} connections={connections} aiReady={aiConfigured()} />
    </PageTransition>
  );
}
