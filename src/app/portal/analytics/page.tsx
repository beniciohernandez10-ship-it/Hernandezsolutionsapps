import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { isStaffAnywhere } from "@/lib/authz";
import { analytics, PERIODS } from "@/lib/analytics/service";
import { formatMinutes } from "@/lib/billing/compute";
import { PRIORITY_LABEL } from "@/lib/tickets/schemas";
import { PageTransition } from "@/components/page-transition";
import { BarList, LineChart } from "@/components/charts";

export const metadata = { title: "Analytics" };

function duration(m: number | null) {
  if (m === null) return "—";
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 60 / 24).toFixed(1)} days`;
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
const pctText = (a: number, b: number) => (b ? `${pct(a, b)}%` : "—");

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card tight stat">
      <span className="value">{value}</span>
      <span className="label">{label}</span>
      {hint && <span className="subtle stat-hint">{hint}</span>}
    </div>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { principal } = await requirePrincipal("/portal/analytics");
  if (!isStaffAnywhere(principal)) {
    return (
      <PageTransition>
        <h1>Analytics</h1>
        <p className="muted">Only technicians can see service-desk analytics.</p>
      </PageTransition>
    );
  }
  const sp = await searchParams;
  const a = await analytics(principal, { customerId: sp.customer || null, days: sp.days ?? 90 });
  const dayOf = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const short = (iso: string) =>
    a.unit === "week"
      ? dayOf(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
      : dayOf(iso).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  const long = (iso: string) =>
    a.unit === "week"
      ? `Week of ${dayOf(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`
      : dayOf(iso).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const labels = a.trend.map((b) => short(b.bucket));
  const details = a.trend.map((b) => long(b.bucket));
  const rated = a.totals.satisfactionGood + a.totals.satisfactionBad;
  const backlogTotal = a.backlog.reduce((s, b) => s + b.count, 0);
  const scope = a.customerId ? a.customers.find((c) => c.id === a.customerId)?.name : a.customers.length === 1 ? a.customers[0].name : `all ${a.customers.length} of your clients`;

  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Service management</p>
          <h1>Analytics</h1>
        </div>
      </div>

      <form className="row report-filters" action="/portal/analytics">
        {a.customers.length > 1 && (
          <>
            <label htmlFor="an-cust" className="sr-only">Client</label>
            <select id="an-cust" name="customer" className="select" defaultValue={a.customerId ?? ""}>
              <option value="">All my clients</option>
              {a.customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </>
        )}
        <label htmlFor="an-days" className="sr-only">Period</label>
        <select id="an-days" name="days" className="select" defaultValue={String(a.days)}>
          {PERIODS.map((d) => (
            <option key={d} value={d}>Last {d === 365 ? "12 months" : `${d} days`}</option>
          ))}
        </select>
        <button className="btn" type="submit">Show</button>
      </form>
      <p className="subtle">
        {scope}, the last {a.days === 365 ? "12 months" : `${a.days} days`}. Times are wall-clock from when a request was opened; trends are by{" "}
        {a.unit} (Pacific time). Client-facing monthly reports are under <Link href="/portal/reports">Reports</Link>.
      </p>

      <section aria-labelledby="kpi-h" className="stack">
        <h2 id="kpi-h" className="sr-only">Summary</h2>
        <div className="grid grid-stats">
          <Tile label="Opened" value={a.totals.created} />
          <Tile label="Resolved" value={a.totals.resolved} />
          <Tile label="Open right now" value={a.totals.openNow} hint={a.unassignedOpen ? `${a.unassignedOpen} unassigned` : "All assigned"} />
          <Tile label="Median first response" value={duration(a.totals.medianFirstResponseMinutes)} />
          <Tile label="Median time to resolve" value={a.totals.medianResolutionHours === null ? "—" : duration(Math.round(a.totals.medianResolutionHours * 60))} />
          <Tile
            label="First-contact resolution"
            value={pctText(a.firstContact.firstContact, a.firstContact.resolved)}
            hint={a.firstContact.resolved ? `${a.firstContact.firstContact} of ${a.firstContact.resolved} resolved with one reply or less` : "Nothing resolved yet"}
          />
          <Tile label="Satisfaction" value={pctText(a.totals.satisfactionGood, rated)} hint={rated ? `${a.totals.satisfactionGood} good · ${a.totals.satisfactionBad} bad of ${rated} rated` : "No ratings yet"} />
        </div>
      </section>

      <section className="card stack" aria-label="Volume">
        <LineChart
          title={`Requests opened and resolved per ${a.unit}`}
          labels={labels}
          details={details}
          series={[
            { key: "opened", label: "Opened", values: a.trend.map((b) => b.created) },
            { key: "resolved", label: "Resolved", values: a.trend.map((b) => b.resolved) },
          ]}
        />
        <details>
          <summary>Show as a table</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{a.unit === "week" ? "Week of" : "Month"}</th>
                  <th scope="col" className="num">Opened</th>
                  <th scope="col" className="num">Resolved</th>
                </tr>
              </thead>
              <tbody>
                {a.trend.map((b, i) => (
                  <tr key={b.bucket}>
                    <td>{details[i].replace("Week of ", "")}</td>
                    <td className="num">{b.created}</td>
                    <td className="num">{b.resolved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="card stack" aria-label="Service levels">
        <LineChart
          title="Service-level targets met"
          labels={labels}
          details={details}
          max={100}
          suffix="%"
          series={[
            { key: "fr", label: "First response", values: a.trend.map((b) => pct(b.firstResponseMet, b.firstResponseTracked)) },
            { key: "res", label: "Resolution", values: a.trend.map((b) => pct(b.resolutionMet, b.resolutionTracked)) },
          ]}
        />
        <p className="subtle">
          First response by when the request was opened; resolution by when it was resolved. Gaps are {a.unit}s with nothing measured.
        </p>
        <details>
          <summary>Show as a table</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{a.unit === "week" ? "Week of" : "Month"}</th>
                  <th scope="col" className="num">First response met</th>
                  <th scope="col" className="num">Resolution met</th>
                </tr>
              </thead>
              <tbody>
                {a.trend.map((b, i) => (
                  <tr key={b.bucket}>
                    <td>{details[i].replace("Week of ", "")}</td>
                    <td className="num">{b.firstResponseTracked ? `${b.firstResponseMet} of ${b.firstResponseTracked}` : "—"}</td>
                    <td className="num">{b.resolutionTracked ? `${b.resolutionMet} of ${b.resolutionTracked}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <div className="grid grid-2">
        <section className="card stack" aria-labelledby="backlog-h">
          <h2 id="backlog-h" className="sr-only">Backlog age</h2>
          <BarList title="Open requests by age" total={backlogTotal} data={a.backlog.map((b) => ({ key: b.label, label: b.label, value: b.count }))} />
          <details>
            <summary>By priority</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Age</th>
                    {(["urgent", "high", "normal", "low"] as const).map((p) => (
                      <th key={p} scope="col" className="num">{PRIORITY_LABEL[p]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {a.backlog.map((b) => (
                    <tr key={b.label}>
                      <td>{b.label}</td>
                      {(["urgent", "high", "normal", "low"] as const).map((p) => (
                        <td key={p} className="num">{b.byPriority[p]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {a.oldest.length > 0 && (
            <div className="stack-tight">
              <h3 className="chart-title">Oldest open</h3>
              <ul className="plain-list" role="list">
                {a.oldest.map((o) => (
                  <li key={o.id}>
                    <Link href={`/portal/tickets/${o.id}`}>#{o.number} {o.title}</Link>
                    <span className="subtle">
                      {" "}· {o.ageDays} day{o.ageDays === 1 ? "" : "s"} · {PRIORITY_LABEL[o.priority]} · {o.customerName} · {o.assignee ?? "unassigned"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="card stack" aria-labelledby="work-h">
          <h2 id="work-h" className="chart-title">Technician workload</h2>
          {a.workload.length === 0 ? (
            <p className="subtle">No technicians.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Technician</th>
                    <th scope="col" className="num">Open</th>
                    <th scope="col" className="num">Resolved</th>
                    <th scope="col" className="num">Median to resolve</th>
                    <th scope="col" className="num">Time logged</th>
                  </tr>
                </thead>
                <tbody>
                  {a.workload.map((w) => (
                    <tr key={w.userId}>
                      <td>{w.name}</td>
                      <td className="num">{w.open}</td>
                      <td className="num">{w.resolved}</td>
                      <td className="num">{w.medianResolutionHours === null ? "—" : duration(Math.round(w.medianResolutionHours * 60))}</td>
                      <td className="num">{w.loggedMinutes ? formatMinutes(w.loggedMinutes) : "—"}</td>
                    </tr>
                  ))}
                  {a.unassignedOpen > 0 && (
                    <tr>
                      <td className="subtle">Unassigned</td>
                      <td className="num">{a.unassignedOpen}</td>
                      <td colSpan={3} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="subtle">Open is right now; resolved, median and time logged are for the period.</p>
        </section>
      </div>
    </PageTransition>
  );
}
