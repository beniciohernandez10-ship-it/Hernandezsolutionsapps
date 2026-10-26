import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { capabilities, customersWhere, STAFF_ROLES } from "@/lib/authz";
import { queueBoard, type QueueCount, type QueueKey } from "@/lib/queues/service";
import { PageTransition } from "@/components/page-transition";
import { QueueWorklist } from "./worklist";

export const metadata = { title: "Queues" };

type SP = Record<string, string | undefined>;

function Tile({ q, href, current }: { q: QueueCount; href: string; current: boolean }) {
  return (
    <Link className="card tight card-link queue-tile" href={href} aria-current={current ? "page" : undefined} scroll={false}>
      <span className="queue-tile-name">{q.name}</span>
      <span className="queue-tile-count">{q.active}</span>
      <span className="queue-tile-meta">
        {q.unassigned > 0 ? `${q.unassigned} unassigned` : "All assigned"}
        {q.breached > 0 && <span className="queue-tile-alert"> · {q.breached} breached</span>}
        {q.breached === 0 && q.atRisk > 0 && <span className="queue-tile-warn"> · {q.atRisk} at risk</span>}
      </span>
    </Link>
  );
}

export default async function QueuesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { principal } = await requirePrincipal("/portal/queues");
  const caps = capabilities(principal);
  if (!caps.staff) {
    return (
      <PageTransition>
        <h1>Queues</h1>
        <p className="muted">Queues are for technicians and service managers.</p>
      </PageTransition>
    );
  }
  const assigned = sp.assigned === "me" || sp.assigned === "unassigned" ? sp.assigned : undefined;
  const requested: QueueKey = sp.queue && /^([0-9a-f-]{36}|none)$/i.test(sp.queue) ? sp.queue : "all";
  const board = await queueBoard(principal, { queue: requested, assigned });
  const { queue, items } = board;

  const href = (o: { queue?: QueueKey; assigned?: string }) => {
    const p = new URLSearchParams();
    const qv = o.queue ?? queue;
    const av = "assigned" in o ? o.assigned : assigned;
    if (qv !== "all") p.set("queue", qv);
    if (av) p.set("assigned", av);
    const s = p.toString();
    return s ? `/portal/queues?${s}` : "/portal/queues";
  };
  const all: QueueCount = {
    id: null,
    name: "All queues",
    ...(["active", "unassigned", "mine", "breached", "atRisk"] as const).reduce(
      (acc, k) => ({ ...acc, [k]: board.queues.reduce((n, q) => n + q[k], board.none[k]) }),
      {} as Omit<QueueCount, "id" | "name">,
    ),
  };
  const currentName = queue === "all" ? "every queue" : queue === "none" ? "no queue" : board.queues.find((q) => q.id === queue)!.name;
  const multiCustomer = customersWhere(principal, (r) => STAFF_ROLES.includes(r)).length > 1;

  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Service desk</p>
          <h1>Queues</h1>
        </div>
        {caps.operator && (
          <Link className="btn" href="/portal/admin/queues" transitionTypes={["nav-forward"]}>Manage queues</Link>
        )}
      </div>
      <nav className="queue-tiles" aria-label="Queues">
        <Tile q={all} href={href({ queue: "all" })} current={queue === "all"} />
        {board.queues.map((q) => (
          <Tile key={q.id} q={q} href={href({ queue: q.id! })} current={queue === q.id} />
        ))}
        <Tile q={board.none} href={href({ queue: "none" })} current={queue === "none"} />
      </nav>
      <div className="spread">
        <div className="tabs" role="group" aria-label="Show">
          <Link href={href({ assigned: undefined })} aria-current={!assigned ? "page" : undefined} className="tab-link" scroll={false}>Everyone</Link>
          <Link href={href({ assigned: "unassigned" })} aria-current={assigned === "unassigned" ? "page" : undefined} className="tab-link" scroll={false}>Unassigned</Link>
          <Link href={href({ assigned: "me" })} aria-current={assigned === "me" ? "page" : undefined} className="tab-link" scroll={false}>Assigned to me</Link>
        </div>
        <p className="subtle">Most urgent first: SLA breaches, then at risk, then priority, then oldest.</p>
      </div>
      <QueueWorklist
        key={`${queue}:${assigned ?? ""}`}
        items={items}
        staff={board.staff}
        queues={board.queues.map((q) => ({ id: q.id!, name: q.name }))}
        currentQueue={queue}
        userId={principal.userId}
        showCustomer={multiCustomer}
        emptyText={assigned === "me" ? `Nothing in ${currentName} is assigned to you.` : `No open requests in ${currentName}.`}
      />
    </PageTransition>
  );
}
