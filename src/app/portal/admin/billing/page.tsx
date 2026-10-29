import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { billingOverview, currentMonthPacific } from "@/lib/billing/service";
import { formatMinutes, formatUsd, monthLabel, shiftMonth } from "@/lib/billing/compute";
import { PageTransition } from "@/components/page-transition";
import { IconBack } from "@/components/icons";

export const metadata = { title: "Billing" };

const KIND = { retainer: "Retainer", block: "Block of hours", hourly: "Hourly" } as const;

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { principal } = await requirePrincipal("/portal/admin/billing");
  if (!principal.isOperator) {
    return (
      <PageTransition>
        <h1>Billing</h1>
        <p className="muted">Only platform operators can see billing.</p>
      </PageTransition>
    );
  }
  const sp = await searchParams;
  const now = currentMonthPacific();
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : now;
  const rows = await billingOverview(principal, month);
  const total = rows.reduce((n, r) => n + r.totals.totalCents, 0);

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
          <h1>Billing</h1>
        </div>
        <div className="row">
          <Link className="btn" href={`/portal/admin/billing?month=${shiftMonth(month, -1)}`} scroll={false}>← {monthLabel(shiftMonth(month, -1))}</Link>
          {month < now && <Link className="btn" href={`/portal/admin/billing?month=${shiftMonth(month, 1)}`} scroll={false}>{monthLabel(shiftMonth(month, 1))} →</Link>}
        </div>
      </div>
      <p className="subtle">
        {monthLabel(month)}
        {month === now ? " (in progress)" : ""} · {formatUsd(total)} across {rows.filter((r) => r.totals.totalCents > 0).length} clients. Open a client to set its
        plan, review time, export for invoicing and finalize the month.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Client</th>
              <th scope="col">Plan</th>
              <th scope="col">Billable</th>
              <th scope="col">Included</th>
              <th scope="col">Overage</th>
              <th scope="col" className="money">Amount</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.customerId}>
                <th scope="row">
                  <Link href={`/portal/admin/billing/${r.customerId}?month=${month}`}>{r.customerName}</Link>
                </th>
                <td>{r.contract ? `${r.contract.name} · ${KIND[r.contract.kind]}` : <span className="subtle">No plan</span>}</td>
                <td className="mono-text">{formatMinutes(r.totals.billableMinutes)}</td>
                <td className="mono-text">{r.contract && r.contract.kind !== "hourly" ? formatMinutes(r.totals.includedAvailableMinutes) : "—"}</td>
                <td className="mono-text">{r.totals.overageMinutes ? formatMinutes(r.totals.overageMinutes) : "—"}</td>
                <td className="money">{formatUsd(r.totals.totalCents)}</td>
                <td>{r.finalized ? "Finalized" : month === now ? "In progress" : r.entryCount || r.contract ? "Ready to finalize" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageTransition>
  );
}
