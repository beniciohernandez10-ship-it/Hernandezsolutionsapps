import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { INCIDENT_STATUS_LABEL, SEVERITY_LABEL, listIncidents, upcomingMaintenance, type IncidentSummary } from "@/lib/incidents/service";
import { PageTransition } from "@/components/page-transition";
import { Time } from "@/components/time";
import { IconCheck, IconPlus } from "@/components/icons";

export const metadata = { title: "Service status" };

function IncidentCard({ i }: { i: IncidentSummary }) {
  return (
    <li>
      <Link className="ticket-row" href={`/portal/incidents/${i.id}`} transitionTypes={["nav-forward"]}>
        <div>
          <div className="title">{i.title}</div>
          <div className="meta">
            <span className="ticket-number">INC-{i.number}</span>
            <span>Since <Time iso={i.startedAt} mode="absolute" /></span>
            {i.allCustomers && <span>All clients</span>}
          </div>
          {i.latest && (
            <p className="subtle incident-latest">
              {i.latest.body} · <Time iso={i.latest.createdAt} />
            </p>
          )}
        </div>
        <div className="row">
          <span className={`badge severity-${i.severity}`}>{SEVERITY_LABEL[i.severity]}</span>
          <span className={`badge incident-${i.status}`}>{INCIDENT_STATUS_LABEL[i.status]}</span>
        </div>
      </Link>
    </li>
  );
}

export default async function StatusPage() {
  const { principal } = await requirePrincipal("/portal/status");
  const manager = principal.memberships.some((m) => m.role === "service_manager");
  const [{ active, recent }, maintenance] = await Promise.all([listIncidents(principal), upcomingMaintenance(principal)]);
  const names = new Map(principal.memberships.map((m) => [m.customerId, m.customerName]));
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Known issues and planned maintenance</p>
          <h1>Service status</h1>
        </div>
        {manager && (
          <Link className="btn btn-primary" href="/portal/incidents/new" transitionTypes={["nav-forward"]}>
            <IconPlus size={16} /> Declare an incident
          </Link>
        )}
      </div>
      <section className="stack" aria-labelledby="active-h">
        <h2 id="active-h">Current issues</h2>
        {active.length === 0 ? (
          <p className="card tight all-clear">
            <IconCheck size={16} /> No known issues right now. If something isn&apos;t working, <Link href="/portal/tickets/new">open a request</Link>.
          </p>
        ) : (
          <ul className="ticket-list" role="list">
            {active.map((i) => (
              <IncidentCard key={i.id} i={i} />
            ))}
          </ul>
        )}
      </section>
      <section className="stack" aria-labelledby="maint-h">
        <h2 id="maint-h">Planned maintenance</h2>
        {maintenance.length === 0 ? (
          <p className="muted">Nothing scheduled.</p>
        ) : (
          <ul className="ticket-list" role="list">
            {maintenance.map((m) => (
              <li key={m.id} className="ticket-row static">
                <div>
                  <div className="title">{m.title}</div>
                  <div className="meta">
                    <span className="ticket-number">CHG-{m.number}</span>
                    {principal.memberships.length > 1 && <span>{names.get(m.customerId)}</span>}
                    {m.plannedStart && (
                      <span>
                        <Time iso={m.plannedStart} mode="absolute" />
                        {m.plannedEnd && <> – <Time iso={m.plannedEnd} mode="absolute" /></>}
                      </span>
                    )}
                  </div>
                  {m.impact && <p className="subtle">{m.impact}</p>}
                </div>
                <div className="row">
                  <span className="badge">{m.status === "in_progress" ? "In progress" : "Scheduled"}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {recent.length > 0 && (
        <section className="stack" aria-labelledby="recent-h">
          <h2 id="recent-h">Resolved in the last 7 days</h2>
          <ul className="ticket-list" role="list">
            {recent.map((i) => (
              <IncidentCard key={i.id} i={i} />
            ))}
          </ul>
        </section>
      )}
    </PageTransition>
  );
}
