import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { listCustomersForOperator } from "@/lib/admin/service";
import { generateDueReports, listMonthlyReports, previousMonth } from "@/lib/reports/monthly";
import { currentMonth } from "@/lib/reports/service";
import { PageTransition } from "@/components/page-transition";
import { IconBack } from "@/components/icons";
import { Time } from "@/components/time";
import { RunReportForm } from "./run-form";

export const metadata = { title: "Monthly reports" };

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function MonthlyReportsPage() {
  const { principal } = await requirePrincipal("/portal/admin/reports");
  if (!principal.isOperator) {
    return (
      <PageTransition>
        <h1>Monthly reports</h1>
        <p className="muted">Only platform operators can run client reports.</p>
      </PageTransition>
    );
  }
  // Catch up if the month-end run was missed (it only builds what's missing).
  await generateDueReports();
  const [reports, customers] = await Promise.all([listMonthlyReports(principal), listCustomersForOperator(principal)]);
  const active = (customers as { id: string; name: string; status: string }[]).filter((c) => c.status === "active");
  const now = currentMonth();
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
          <h1>Monthly reports</h1>
        </div>
      </div>
      <p className="subtle">
        A report for each client, ready to send to its owners: every request resolved that month, how it was solved, who solved it, whether it met its
        service-level target, and what the requests were about. When a month ends, its reports are created automatically and saved as they were
        on that day.
      </p>

      <RunReportForm customers={active.map((c) => ({ id: c.id, name: c.name }))} defaultMonth={previousMonth(now)} maxMonth={now} />

      <section className="stack" aria-labelledby="saved-h">
        <h2 id="saved-h">Saved reports</h2>
        {reports.length === 0 ? (
          <p className="muted">No reports yet. Run one above, or wait for the first month to end.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Client</th>
                  <th scope="col">Month</th>
                  <th scope="col">Resolved</th>
                  <th scope="col">Missed target</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">
                      <Link href={`/portal/admin/reports/${r.id}`} transitionTypes={["nav-forward"]}>{r.customerName}</Link>
                    </th>
                    <td>{monthLabel(r.month)}</td>
                    <td>{r.resolved}</td>
                    <td>{r.slaMissed}</td>
                    <td>
                      <Time iso={r.generatedAt} mode="absolute" />
                      <span className="subtle"> · {r.generatedBy ?? "automatic"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageTransition>
  );
}
