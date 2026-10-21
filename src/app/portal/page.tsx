import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { capabilities } from "@/lib/authz";
import { dashboard, listTickets } from "@/lib/tickets/service";
import { pendingApprovals } from "@/lib/catalog/service";
import { Time } from "@/components/time";
import { PageTransition } from "@/components/page-transition";
import { TicketList } from "./tickets/ticket-list";
import { IconPlus } from "@/components/icons";

export const metadata = { title: "Overview" };

function formatDuration(s: number) {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} days`;
}

export default async function Overview() {
  const { principal } = await requirePrincipal();
  const caps = capabilities(principal);
  if (principal.memberships.length === 0) {
    return (
      <PageTransition>
        <div className="page-head"><h1>Welcome, {principal.displayName}</h1></div>
        <p className="muted">
          {caps.operator
            ? "You have platform administration access. Ticket access requires a separate customer assignment."
            : "Your account isn't assigned to an organization yet."}
        </p>
        {caps.operator && <Link className="btn btn-primary" href="/portal/admin">Open administration</Link>}
      </PageTransition>
    );
  }
  const [stats, approvals, recent] = await Promise.all([
    dashboard(principal),
    pendingApprovals(principal),
    listTickets(principal, caps.staff ? { status: "active", pageSize: 6 } : { pageSize: 6 }),
  ]);
  const s = stats!;
  const orgs = principal.memberships.map((m) => m.customerName).join(", ");
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">{orgs}</p>
          <h1>Hello, {principal.displayName.split(" ")[0]}</h1>
        </div>
        {caps.canCreate && (
          <Link className="btn btn-primary" href="/portal/tickets/new" transitionTypes={["nav-forward"]}>
            <IconPlus size={16} /> New request
          </Link>
        )}
      </div>
      {approvals.length > 0 && (
        <section aria-labelledby="approvals-h" className="card stack">
          <h2 id="approvals-h">Waiting for your approval ({approvals.length})</h2>
          <ul className="stack" role="list">
            {approvals.map((a) => (
              <li key={a.ticketId} className="spread">
                <Link href={`/portal/tickets/${a.ticketId}`} transitionTypes={["nav-forward"]}>
                  <span className="ticket-number">#{a.number}</span> {a.title}
                </Link>
                <span className="subtle">
                  {a.requesterName}
                  {principal.memberships.length > 1 ? ` · ${a.customerName}` : ""} · <Time iso={a.requestedAt} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="stats-h" className="stack">
        <h2 id="stats-h" className="sr-only">Ticket counts</h2>
        <div className="grid grid-stats">
          <Stat label="Open" value={s.open} href="/portal/tickets?status=open" />
          <Stat label="In progress" value={s.inProgress} href="/portal/tickets?status=in_progress" />
          <Stat label="Waiting on you" value={s.waiting} href="/portal/tickets?status=waiting" hint={caps.staff ? "Waiting on customer" : undefined} />
          <Stat label="Resolved (30 days)" value={s.resolved30d} href="/portal/tickets?status=resolved" />
          {caps.staff && <Stat label="Unassigned" value={s.unassigned} href="/portal/tickets?assigned=unassigned" />}
          {caps.staff && <Stat label="Assigned to me" value={s.assignedToMe} href="/portal/tickets?assigned=me" />}
          {caps.staff && <Stat label="SLA missed (open)" value={s.slaBreached} href="/portal/tickets?status=active" />}
          {caps.staff && <Stat label="SLA due soon" value={s.slaAtRisk} href="/portal/tickets?status=active" />}
        </div>
        {caps.staff && s.slaFirstResponseSample30d > 0 && (
          <p className="subtle">
            First-response target met on {s.slaFirstResponseMet30d} of {s.slaFirstResponseSample30d} tickets with a service level in the last 30 days
            ({Math.round((s.slaFirstResponseMet30d / s.slaFirstResponseSample30d) * 100)}%). Technicians only.
          </p>
        )}
        <p className="subtle">
          {s.medianFirstResponseSeconds !== null
            ? `Median first response over the last 30 days: ${formatDuration(s.medianFirstResponseSeconds)} (from ${s.respondedSample30d} ticket${s.respondedSample30d === 1 ? "" : "s"}). This is an observed figure, not an SLA commitment.`
            : "No first-response data in the last 30 days yet."}
        </p>
      </section>
      <section aria-labelledby="recent-h" className="stack">
        <div className="spread">
          <h2 id="recent-h">{caps.staff ? "Active tickets" : "Recent requests"}</h2>
          <Link href="/portal/tickets" transitionTypes={["nav-forward"]}>View all</Link>
        </div>
        <TicketList items={recent.items} showCustomer={principal.memberships.length > 1} emptyText="No requests yet. When you submit one, it will show up here." />
      </section>
    </PageTransition>
  );
}

function Stat({ label, value, href, hint }: { label: string; value: number; href: string; hint?: string }) {
  return (
    <Link className="card tight card-link stat" href={href} transitionTypes={["nav-forward"]}>
      <span className="value">{value}</span>
      <span className="label">{hint ?? label}</span>
    </Link>
  );
}
