import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { capabilities } from "@/lib/authz";
import { listQueuesAdmin } from "@/lib/queues/service";
import { PageTransition } from "@/components/page-transition";
import { IconBack } from "@/components/icons";
import { QueuesConsole } from "./console";
import { HardwareRouting } from "./routing";
import { getHardwareSettings } from "@/lib/hardware/service";

export const metadata = { title: "Queues" };

export default async function QueuesAdminPage() {
  const { principal } = await requirePrincipal("/portal/admin/queues");
  if (!principal.isOperator) {
    return (
      <PageTransition>
        <h1>Queues</h1>
        <p className="muted">Only platform operators can manage queues.</p>
      </PageTransition>
    );
  }
  const [queues, hardware] = await Promise.all([listQueuesAdmin(principal), getHardwareSettings(principal)]);
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
          <h1>Queues</h1>
        </div>
        {capabilities(principal).staff && (
          <Link className="btn" href="/portal/queues" transitionTypes={["nav-forward"]}>Open the queues</Link>
        )}
      </div>
      <p className="subtle">
        Queues group requests for a team, such as the service desk or project work. Technicians see every queue for the clients they support.
        Assignment rules can send new requests straight to a queue.
      </p>
      <QueuesConsole queues={queues} />
      <HardwareRouting settings={hardware} queues={queues.map((q) => ({ id: q.id, name: q.name }))} />
    </PageTransition>
  );
}
