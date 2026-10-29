import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { listCustomersForOperator } from "@/lib/admin/service";
import { monitoringSetup } from "@/lib/monitoring/service";
import { config } from "@/lib/config";
import { PageTransition } from "@/components/page-transition";
import { IconBack } from "@/components/icons";
import { CheckSettings, Sources } from "./console";

export const metadata = { title: "Monitoring" };

export default async function MonitoringAdminPage() {
  const { principal } = await requirePrincipal("/portal/admin/monitoring");
  if (!principal.isOperator) {
    return (
      <PageTransition>
        <h1>Monitoring</h1>
        <p className="muted">Only platform operators can change monitoring.</p>
      </PageTransition>
    );
  }
  const [setup, customers] = await Promise.all([monitoringSetup(principal), listCustomersForOperator(principal)]);
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
          <h1>Monitoring</h1>
        </div>
        <Link className="btn" href="/portal/alerts" transitionTypes={["nav-forward"]}>Open alerts</Link>
      </div>
      <p className="subtle">
        Monitoring turns problems into requests automatically, from the IT Center Monitoring account. Checks run at most hourly while the portal is
        in use, and daily regardless. Assignment rules apply to these requests like any other.
      </p>

      <section className="stack" aria-labelledby="checks-h">
        <h2 id="checks-h">Built-in checks</h2>
        <p className="subtle">
          These use data the IT Center already has: Intune compliance and check-ins (needs Intune connected for the client), asset warranty dates, and
          Microsoft 365 license counts.
        </p>
        <CheckSettings settings={setup.settings} />
      </section>

      <section className="stack" aria-labelledby="sources-h">
        <h2 id="sources-h">Connected tools</h2>
        <p className="subtle">
          Any tool that can send a webhook (Atera, an RMM, uptime or backup monitoring) can post alerts here. Each tool gets its own address and secret
          token.
        </p>
        <Sources
          sources={setup.sources}
          customers={(customers as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name }))}
          origin={config().appOrigin}
        />
      </section>
    </PageTransition>
  );
}
