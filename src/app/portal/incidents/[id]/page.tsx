import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePrincipal } from "@/lib/auth/current";
import { INCIDENT_STATUS_LABEL, SEVERITY_LABEL, getIncident } from "@/lib/incidents/service";
import { markRead } from "@/lib/notify/service";
import { AppError } from "@/lib/errors";
import { STATUS_LABEL } from "@/lib/tickets/schemas";
import { PageTransition } from "@/components/page-transition";
import { Time } from "@/components/time";
import { IconBack } from "@/components/icons";
import { IncidentUpdateForm } from "./update-form";

export const metadata = { title: "Incident" };

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { principal } = await requirePrincipal(`/portal/incidents/${id}`);
  let i;
  try {
    i = await getIncident(principal, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  await markRead(principal, { incidentId: i.id }).catch(() => 0);
  return (
    <PageTransition>
      <p>
        <Link href="/portal/status" transitionTypes={["nav-back"]} className="subtle">
          <IconBack size={14} /> Service status
        </Link>
      </p>
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <span className="ticket-number">INC-{i.number}</span> · {i.allCustomers ? "All clients" : i.customers.map((c) => c.name).join(", ")}
          </p>
          <h1>{i.title}</h1>
          <div className="row">
            <span className={`badge severity-${i.severity}`}>{SEVERITY_LABEL[i.severity]}</span>
            <span className={`badge incident-${i.status}`}>{INCIDENT_STATUS_LABEL[i.status]}</span>
          </div>
        </div>
      </div>
      <div className="detail-grid">
        <div className="stack">
          {i.canManage && i.status !== "resolved" && <IncidentUpdateForm id={i.id} linkedCount={i.tickets.length} />}
          <section aria-labelledby="upd-h" className="stack">
            <h2 id="upd-h">Updates</h2>
            <ol className="stack incident-updates">
              {i.updates.map((u, n) => (
                <li key={n} className="card tight">
                  <p className="eyebrow">
                    {INCIDENT_STATUS_LABEL[u.status]} · <Time iso={u.createdAt} mode="absolute" />
                    {u.authorName && <> · {u.authorName}</>}
                  </p>
                  <p className="prewrap">{u.body}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="stack" aria-label="Incident details">
          <section className="card tight">
            <h2 className="eyebrow">Details</h2>
            <dl className="kv">
              <dt>Started</dt>
              <dd><Time iso={i.startedAt} mode="absolute" /></dd>
              {i.resolvedAt && (
                <>
                  <dt>Resolved</dt>
                  <dd><Time iso={i.resolvedAt} mode="absolute" /></dd>
                </>
              )}
            </dl>
          </section>
          {i.tickets.length > 0 && (
            <section className="card tight stack">
              <h2 className="eyebrow">{i.canManage ? "Linked requests" : "Your linked requests"}</h2>
              <ul className="stack" role="list">
                {i.tickets.map((t) => (
                  <li key={t.id}>
                    <Link href={`/portal/tickets/${t.id}`}>#{t.number} {t.title}</Link>{" "}
                    <span className="subtle">({STATUS_LABEL[t.status]}{i.canManage ? ` · ${t.customerName}` : ""})</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </PageTransition>
  );
}
