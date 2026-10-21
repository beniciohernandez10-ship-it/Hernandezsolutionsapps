import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { capabilities, ORG_ROLES } from "@/lib/authz";
import { CHANGE_STATUS_LABEL, listChanges, type ChangeSummary } from "@/lib/changes/service";
import { PageTransition } from "@/components/page-transition";
import { Time } from "@/components/time";
import { IconInbox, IconPlus } from "@/components/icons";

export const metadata = { title: "Changes" };

const RISK_LABEL = { low: "Low risk", medium: "Medium risk", high: "High risk" } as const;
const TYPE_LABEL = { standard: "Standard", normal: "Normal", emergency: "Emergency" } as const;

function dayKey(iso: string | null) {
  if (!iso) return "Not scheduled yet";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
}

export default async function ChangesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { principal } = await requirePrincipal("/portal/changes");
  const sp = await searchParams;
  const caps = capabilities(principal);
  if (!principal.memberships.some((m) => ORG_ROLES.includes(m.role))) {
    return (
      <PageTransition>
        <h1>Changes</h1>
        <p className="muted">Planned changes are visible to organization administrators and technicians.</p>
      </PageTransition>
    );
  }
  const scope = sp.scope === "all" ? "all" : "upcoming";
  const items = await listChanges(principal, { scope });
  const groups = new Map<string, ChangeSummary[]>();
  for (const c of items) {
    const k = dayKey(c.plannedStart);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Planned work and maintenance</p>
          <h1>Change calendar</h1>
        </div>
        {caps.staff && (
          <Link className="btn btn-primary" href="/portal/changes/new" transitionTypes={["nav-forward"]}>
            <IconPlus size={16} /> Plan a change
          </Link>
        )}
      </div>
      <div className="tabs" role="group" aria-label="Show">
        <Link href="/portal/changes" aria-current={scope === "upcoming" ? "page" : undefined} className="tab-link">Upcoming</Link>
        <Link href="/portal/changes?scope=all" aria-current={scope === "all" ? "page" : undefined} className="tab-link">All</Link>
      </div>
      {items.length === 0 ? (
        <div className="empty">
          <IconInbox size={28} />
          <p>No planned changes.</p>
        </div>
      ) : (
        [...groups.entries()].map(([day, list]) => (
          <section key={day} className="stack" aria-label={day}>
            <h2 className="eyebrow">{day}</h2>
            <ul className="ticket-list" role="list">
              {list.map((c) => (
                <li key={c.id}>
                  <Link className="ticket-row" href={`/portal/changes/${c.id}`} transitionTypes={["nav-forward"]}>
                    <div>
                      <div className="title">{c.title}</div>
                      <div className="meta">
                        <span className="ticket-number">CHG-{c.number}</span>
                        {principal.memberships.length > 1 && <span>{c.customerName}</span>}
                        {c.plannedStart && (
                          <span>
                            <Time iso={c.plannedStart} mode="absolute" />
                            {c.plannedEnd && <> – <Time iso={c.plannedEnd} mode="absolute" /></>}
                          </span>
                        )}
                        <span>{TYPE_LABEL[c.changeType]} · {RISK_LABEL[c.risk]}</span>
                      </div>
                    </div>
                    <div className="row">
                      <span className={`badge change-${c.status}`}>{CHANGE_STATUS_LABEL[c.status]}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </PageTransition>
  );
}
