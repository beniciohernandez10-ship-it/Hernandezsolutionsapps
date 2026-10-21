import { requirePrincipal } from "@/lib/auth/current";
import { ORG_ROLES } from "@/lib/authz";
import { buildReport, currentMonth } from "@/lib/reports/service";
import { CATEGORY_LABEL, PRIORITY_LABEL } from "@/lib/tickets/schemas";
import { PageTransition } from "@/components/page-transition";
import { BarList, ColumnChart } from "@/components/charts";
import { PrintButton } from "./print-button";

export const metadata = { title: "Reports" };

function minutes(m: number | null) {
  if (m === null) return "—";
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 60 / 24).toFixed(1)} days`;
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card tight stat">
      <span className="value">{value}</span>
      <span className="label">{label}</span>
      {hint && <span className="subtle stat-hint">{hint}</span>}
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { principal } = await requirePrincipal("/portal/reports");
  const sp = await searchParams;
  const orgs = principal.memberships.filter((m) => ORG_ROLES.includes(m.role));
  if (!orgs.length) {
    return (
      <PageTransition>
        <h1>Reports</h1>
        <p className="muted">Reports are available to organization administrators and technicians.</p>
      </PageTransition>
    );
  }
  const customerId = orgs.some((o) => o.customerId === sp.customer) ? sp.customer! : orgs[0].customerId;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : currentMonth();
  const r = await buildReport(principal, { customerId, month });
  const monthLabel = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const rated = r.satisfaction.good + r.satisfaction.bad;
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">{r.customerName}</p>
          <h1>Service report · {monthLabel}</h1>
        </div>
        <div className="row no-print">
          <PrintButton />
          {r.staffView && (
            <a className="btn" href={`/api/reports/export?customerId=${customerId}&month=${month}`} download>
              Download CSV
            </a>
          )}
        </div>
      </div>

      <form className="row report-filters no-print" action="/portal/reports">
        {orgs.length > 1 && (
          <>
            <label htmlFor="rep-cust" className="sr-only">Organization</label>
            <select id="rep-cust" name="customer" className="select" defaultValue={customerId}>
              {orgs.map((o) => (
                <option key={o.customerId} value={o.customerId}>{o.customerName}</option>
              ))}
            </select>
          </>
        )}
        <label htmlFor="rep-month" className="sr-only">Month</label>
        <input id="rep-month" name="month" type="month" className="input" defaultValue={month} max={currentMonth()} />
        <button className="btn" type="submit">Show</button>
      </form>

      <section aria-labelledby="kpi-h" className="stack">
        <h2 id="kpi-h" className="sr-only">Summary</h2>
        <div className="grid grid-stats">
          <Tile label="Requests opened" value={r.created} hint={`${r.incidents} problems · ${r.requests} catalog requests`} />
          <Tile label="Resolved" value={r.resolved} />
          <Tile label="Open right now" value={r.openNow} />
          <Tile label="Median first response" value={minutes(r.medianFirstResponseMinutes)} />
          <Tile label="Median time to resolve" value={r.medianResolutionHours === null ? "—" : minutes(Math.round(r.medianResolutionHours * 60))} />
          <Tile label="Satisfaction" value={pct(r.satisfaction.good, rated)} hint={rated ? `${r.satisfaction.good} 👍 · ${r.satisfaction.bad} 👎 of ${rated} rated` : "No ratings yet"} />
        </div>
        <p className="subtle">Times are wall-clock, from when a request was opened. Figures come only from requests in the IT Center for {monthLabel} (Pacific time).</p>
      </section>

      <section className="card stack">
        <ColumnChart
          title="Requests opened per day"
          valueLabel="opened"
          data={r.daily.map((d) => ({
            key: d.day,
            label: String(day(d.day).getUTCDate()),
            value: d.created,
            detail: `${day(d.day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}: ${d.created} opened, ${d.resolved} resolved`,
          }))}
        />
        <details>
          <summary>Show as a table</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Opened</th>
                  <th scope="col">Resolved</th>
                </tr>
              </thead>
              <tbody>
                {r.daily.map((d) => (
                  <tr key={d.day}>
                    <th scope="row">{d.day}</th>
                    <td>{d.created}</td>
                    <td>{d.resolved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <div className="grid grid-2">
        <section className="card">
          <BarList title="By category" total={r.created} data={r.byCategory.map((c) => ({ key: c.category, label: CATEGORY_LABEL[c.category], value: c.count }))} />
        </section>
        <section className="card">
          <BarList title="By priority" total={r.created} data={r.byPriority.filter((p) => p.count).map((p) => ({ key: p.priority, label: PRIORITY_LABEL[p.priority], value: p.count }))} />
        </section>
      </div>

      {r.sla && (
        <section className="stack" aria-labelledby="sla-h">
          <h2 id="sla-h">Service levels <span className="subtle">· technicians only</span></h2>
          {r.sla.tickets === 0 ? (
            <p className="muted">No requests this month had a service level. Assign one under Administration → Service levels.</p>
          ) : (
            <div className="grid grid-stats">
              <Tile label="First response on time" value={pct(r.sla.firstResponseMet, r.sla.firstResponseMet + r.sla.firstResponseMissed)} hint={`${r.sla.firstResponseMet} met · ${r.sla.firstResponseMissed} missed`} />
              <Tile label="Resolved on time" value={pct(r.sla.resolutionMet, r.sla.resolutionMet + r.sla.resolutionMissed)} hint={`${r.sla.resolutionMet} met · ${r.sla.resolutionMissed} missed`} />
              <Tile label="Requests with a service level" value={r.sla.tickets} />
            </div>
          )}
        </section>
      )}

      <div className="grid grid-2">
        <section className="card stack" aria-labelledby="top-h">
          <h2 id="top-h" className="chart-title">Who asked most</h2>
          {r.topRequesters.length === 0 ? (
            <p className="subtle">Nothing yet.</p>
          ) : (
            <ol className="stack">
              {r.topRequesters.map((t) => (
                <li key={t.name}>
                  {t.name} <span className="subtle">· {t.count}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        {r.staffView && (
          <section className="card stack" aria-labelledby="comments-h">
            <h2 id="comments-h" className="chart-title">Recent comments <span className="subtle">· technicians only</span></h2>
            {r.comments.length === 0 ? (
              <p className="subtle">No comments this month.</p>
            ) : (
              <ul className="stack" role="list">
                {r.comments.map((c, i) => (
                  <li key={i}>
                    <span className="ticket-number">#{c.number}</span> {c.rating === "good" ? "👍" : "👎"} <span className="prewrap">{c.comment}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </PageTransition>
  );
}
