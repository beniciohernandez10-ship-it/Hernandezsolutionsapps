import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePrincipal } from "@/lib/auth/current";
import { CHANGE_STATUS_LABEL, getChange } from "@/lib/changes/service";
import { markRead } from "@/lib/notify/service";
import { AppError } from "@/lib/errors";
import { PageTransition } from "@/components/page-transition";
import { Time } from "@/components/time";
import { IconBack } from "@/components/icons";
import { ChangeActions, ChangeApproval, ChangeTickets } from "./controls";

export const metadata = { title: "Change" };

const EVENT: Record<string, string> = {
  created: "created this change",
  submitted: "submitted it for approval",
  approved: "approved it",
  rejected: "did not approve it",
  scheduled: "scheduled it",
  started: "started the work",
  completed: "completed it",
  failed: "marked it failed and backed out",
  cancelled: "cancelled it",
  edited: "edited it",
};
const RISK = { low: "Low", medium: "Medium", high: "High" } as const;
const TYPE = { standard: "Standard (pre-approved)", normal: "Normal", emergency: "Emergency" } as const;

export default async function ChangePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { principal } = await requirePrincipal(`/portal/changes/${id}`);
  let c;
  try {
    c = await getChange(principal, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  await markRead(principal, { changeId: c.id }).catch(() => 0);
  const v = c.viewer;
  return (
    <PageTransition>
      <p>
        <Link href="/portal/changes" transitionTypes={["nav-back"]} className="subtle">
          <IconBack size={14} /> Change calendar
        </Link>
      </p>
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <span className="ticket-number">CHG-{c.number}</span> · {c.customerName}
          </p>
          <h1>{c.title}</h1>
          <div className="row">
            <span className={`badge change-${c.status}`}>{CHANGE_STATUS_LABEL[c.status]}</span>
            <span className="badge">{RISK[c.risk]} risk</span>
          </div>
        </div>
        {v.canEdit && (
          <Link className="btn" href={`/portal/changes/${c.id}/edit`} transitionTypes={["nav-forward"]}>Edit</Link>
        )}
      </div>
      <div className="detail-grid">
        <div className="stack">
          <article className="card stack">
            <p className="prewrap">{c.description}</p>
            {c.impact && (
              <div>
                <h2 className="eyebrow">What people will notice</h2>
                <p className="prewrap">{c.impact}</p>
              </div>
            )}
          </article>
          {(v.isStaff || c.implementationPlan) && (
            <section className="card stack" aria-labelledby="plan-h">
              <h2 id="plan-h" className="eyebrow">Implementation plan</h2>
              <p className="prewrap">{c.implementationPlan || "Not written yet."}</p>
              <h2 className="eyebrow">Backout plan</h2>
              <p className="prewrap">{c.backoutPlan || "Not written yet."}</p>
            </section>
          )}
          {c.outcomeNote && (
            <section className="card resolution" aria-labelledby="outcome-h">
              <h2 id="outcome-h" className="eyebrow">Outcome</h2>
              <p className="prewrap">{c.outcomeNote}</p>
            </section>
          )}
          <section aria-labelledby="hist-h">
            <h2 id="hist-h" className="sr-only">History</h2>
            <ol className="timeline">
              {c.events.map((e, i) => (
                <li key={i} className="event">
                  {e.actorName ?? "Someone"} {EVENT[e.kind] ?? e.kind} · <Time iso={e.createdAt} />
                  {e.note && <span className="prewrap"> — {e.note}</span>}
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="stack" aria-label="Change details">
          {(c.approvalStatus !== "not_required" || v.canDecide) && (
            <ChangeApproval
              changeId={c.id}
              status={c.approvalStatus}
              canDecide={v.canDecide}
              decidedBy={c.approvalDecidedByName}
              note={c.approvalNote}
              approver={c.changeType === "emergency" ? "a Hernandez Solutions service manager" : "the organization's administrator"}
            />
          )}
          <section className="card tight">
            <h2 className="eyebrow">Details</h2>
            <dl className="kv">
              <dt>Type</dt>
              <dd>{TYPE[c.changeType]}</dd>
              <dt>Window</dt>
              <dd>
                {c.plannedStart ? (
                  <>
                    <Time iso={c.plannedStart} mode="absolute" />
                    {c.plannedEnd && <> to <Time iso={c.plannedEnd} mode="absolute" /></>}
                  </>
                ) : (
                  "Not set"
                )}
              </dd>
              <dt>Technician</dt>
              <dd>{c.implementerName ?? "Not decided"}</dd>
              <dt>Planned by</dt>
              <dd>{c.createdByName}</dd>
            </dl>
          </section>
          {v.actions.length > 0 && <ChangeActions changeId={c.id} actions={v.actions} />}
          {(v.isStaff || c.tickets.length > 0) && <ChangeTickets changeId={c.id} tickets={c.tickets} canEdit={v.isStaff} />}
        </aside>
      </div>
    </PageTransition>
  );
}
