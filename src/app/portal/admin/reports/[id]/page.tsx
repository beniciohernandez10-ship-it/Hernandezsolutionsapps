import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePrincipal } from "@/lib/auth/current";
import { AppError } from "@/lib/errors";
import { getMonthlyReport } from "@/lib/reports/monthly";
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL, type Status } from "@/lib/tickets/schemas";
import { PageTransition } from "@/components/page-transition";
import { BarList } from "@/components/charts";
import { IconBack } from "@/components/icons";
import { PrintButton } from "@/app/portal/reports/print-button";
import { RerunButton } from "./rerun";

export const metadata = { title: "Monthly report" };

function duration(minutes: number | null) {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1)} h`;
  return `${(minutes / 60 / 24).toFixed(1)} days`;
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

const date = (iso: string, tz: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz });

function Target({ t }: { t: "met" | "missed" | "none" }) {
  if (t === "met") return <span className="badge status-resolved">Met</span>;
  if (t === "missed") return <span className="badge priority-high">Missed</span>;
  return <span className="subtle">No target</span>;
}

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card tight stat">
      <span className="value">{value}</span>
      <span className="label">{label}</span>
      {hint && <span className="subtle stat-hint">{hint}</span>}
    </div>
  );
}

export default async function MonthlyReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { principal } = await requirePrincipal(`/portal/admin/reports/${id}`);
  if (!principal.isOperator) {
    return (
      <PageTransition>
        <h1>Monthly report</h1>
        <p className="muted">Only platform operators can view client reports.</p>
      </PageTransition>
    );
  }
  let saved;
  try {
    saved = await getMonthlyReport(principal, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const r = saved.report;
  const s = r.summary;
  const tz = r.timeZone;
  const monthLabel = new Date(`${r.month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const rated = s.satisfactionGood + s.satisfactionBad;
  const totalCategorized = r.byCategory.reduce((a, c) => a + c.count, 0);
  return (
    <PageTransition>
      <p className="no-print">
        <Link href="/portal/admin/reports" transitionTypes={["nav-back"]} className="subtle">
          <IconBack size={14} /> Monthly reports
        </Link>
      </p>
      <div className="page-head">
        <div>
          <p className="eyebrow">Hernandez Solutions · IT service report</p>
          <h1>{r.customerName} · {monthLabel}</h1>
          <p className="subtle">
            Prepared {new Date(saved.generatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: tz })}
            <span className="no-print"> · {saved.generatedBy ? `run by ${saved.generatedBy}` : "created automatically at month end"}</span>
          </p>
        </div>
        <div className="row no-print">
          <PrintButton />
          <a className="btn" href={`/api/admin/reports/${id}/csv`} download>Download CSV</a>
          <RerunButton customerId={r.customerId} month={r.month} />
        </div>
      </div>

      <section aria-labelledby="sum-h" className="stack">
        <h2 id="sum-h">Summary</h2>
        <div className="grid grid-stats">
          <Tile label="Requests opened" value={s.opened} />
          <Tile label="Requests resolved" value={s.resolved} />
          <Tile label="Still open" value={s.stillOpen} hint="When this report was prepared" />
          <Tile
            label="Resolved within target"
            value={pct(s.slaMet, s.slaTracked)}
            hint={s.slaTracked ? `${s.slaMet} met · ${s.slaMissed} missed of ${s.slaTracked}` : "No service-level targets this month"}
          />
          <Tile label="Typical first response" value={duration(s.medianFirstResponseMinutes)} hint="Median" />
          <Tile label="Typical time to resolve" value={s.medianResolutionHours === null ? "—" : duration(Math.round(s.medianResolutionHours * 60))} hint="Median" />
          <Tile label="Satisfaction" value={pct(s.satisfactionGood, rated)} hint={rated ? `${s.satisfactionGood} of ${rated} ratings positive` : "No ratings this month"} />
        </div>
      </section>

      <div className="grid grid-2">
        <section className="card">
          <BarList
            title="What the requests were about"
            total={totalCategorized}
            data={r.byCategory.map((c) => ({ key: c.category, label: CATEGORY_LABEL[c.category] ?? c.category, value: c.count }))}
          />
        </section>
        <section className="card">
          <BarList title="Resolved by" total={s.resolved} data={r.byTechnician.map((t) => ({ key: t.name, label: t.name, value: t.count }))} />
        </section>
      </div>
      <section className="card">
        <BarList
          title="Urgency of requests opened"
          total={s.opened}
          data={r.byPriority.filter((p) => p.count).map((p) => ({ key: p.priority, label: PRIORITY_LABEL[p.priority], value: p.count }))}
        />
      </section>

      <section className="stack" aria-labelledby="res-h">
        <h2 id="res-h">Requests resolved in {monthLabel}</h2>
        {r.resolvedTickets.length === 0 ? (
          <p className="muted">No requests were resolved this month.</p>
        ) : (
          <div className="table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Category</th>
                  <th scope="col">Opened</th>
                  <th scope="col">Resolved</th>
                  <th scope="col">Resolved by</th>
                  <th scope="col">Time to resolve</th>
                  <th scope="col">Target</th>
                  <th scope="col">How it was solved</th>
                </tr>
              </thead>
              <tbody>
                {r.resolvedTickets.map((t) => (
                  <tr key={t.number}>
                    <th scope="row">
                      <span className="ticket-number">#{t.number}</span> {t.title}
                      <span className="subtle"> · {t.requester}</span>
                    </th>
                    <td>{CATEGORY_LABEL[t.category] ?? t.category}</td>
                    <td>{date(t.openedAt, tz)}</td>
                    <td>{date(t.resolvedAt, tz)}</td>
                    <td>{t.resolvedBy ?? "—"}</td>
                    <td>{duration(Math.round(t.hoursToResolve * 60))}</td>
                    <td><Target t={t.resolutionTarget} /></td>
                    <td className="prewrap">{t.resolution ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {r.openTickets.length > 0 && (
        <section className="stack" aria-labelledby="open-h">
          <h2 id="open-h">Still open when this report was prepared</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Status</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Opened</th>
                  <th scope="col">Assigned to</th>
                </tr>
              </thead>
              <tbody>
                {r.openTickets.map((t) => (
                  <tr key={t.number}>
                    <th scope="row"><span className="ticket-number">#{t.number}</span> {t.title}</th>
                    <td>{STATUS_LABEL[t.status as Status] ?? t.status}</td>
                    <td>{PRIORITY_LABEL[t.priority]}</td>
                    <td>{date(t.openedAt, tz)}</td>
                    <td>{t.assignee ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="subtle">
        Dates are Pacific time. &quot;Target&quot; is the agreed time to resolve a request of that priority, counted in business hours and paused
        while we waited on a reply. Times to resolve are from opening to resolution, including evenings and weekends.
      </p>
    </PageTransition>
  );
}
