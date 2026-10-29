import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePrincipal } from "@/lib/auth/current";
import { AppError } from "@/lib/errors";
import { billingDetail, currentMonthPacific } from "@/lib/billing/service";
import { formatMinutes, formatUsd, monthLabel, roundEntry, shiftMonth } from "@/lib/billing/compute";
import { PageTransition } from "@/components/page-transition";
import { IconBack } from "@/components/icons";
import { ContractForm, MonthActions } from "./controls";

export const metadata = { title: "Client billing" };

export default async function ClientBillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { customerId } = await params;
  const sp = await searchParams;
  const { principal } = await requirePrincipal(`/portal/admin/billing/${customerId}`);
  if (!principal.isOperator) notFound();
  const now = currentMonthPacific();
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : now;
  let d;
  try {
    d = await billingDetail(principal, customerId, month);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const t = d.totals;
  const inc = d.contract?.roundingMinutes ?? 1;
  const here = (m: string) => `/portal/admin/billing/${customerId}?month=${m}`;

  return (
    <PageTransition>
      <p>
        <Link href={`/portal/admin/billing?month=${month}`} transitionTypes={["nav-back"]} className="subtle">
          <IconBack size={14} /> Billing
        </Link>
      </p>
      <div className="page-head">
        <div>
          <p className="eyebrow">{monthLabel(month)}</p>
          <h1>{d.customerName}</h1>
        </div>
        <div className="row">
          <Link className="btn" href={here(shiftMonth(month, -1))} scroll={false}>← Previous</Link>
          {month < now && <Link className="btn" href={here(shiftMonth(month, 1))} scroll={false}>Next →</Link>}
        </div>
      </div>

      <div className="grid grid-stats">
        <div className="card tight stat">
          <span className="value">{formatMinutes(t.billableMinutes)}</span>
          <span className="label">Billable time{inc > 1 ? ` (rounded to ${inc} min)` : ""}</span>
        </div>
        {d.contract && d.contract.kind !== "hourly" && (
          <div className="card tight stat">
            <span className="value">{formatMinutes(t.includedAvailableMinutes)}</span>
            <span className="label">{d.contract.kind === "block" ? "Block left at month start" : "Included this month"}</span>
          </div>
        )}
        <div className="card tight stat">
          <span className="value">{formatMinutes(t.overageMinutes)}</span>
          <span className="label">{d.contract?.kind === "hourly" ? "Billed hourly" : "Over the plan"}</span>
        </div>
        <div className="card tight stat">
          <span className="value">{formatUsd(t.totalCents)}</span>
          <span className="label">
            {t.feeCents ? `${formatUsd(t.feeCents)} plan + ${formatUsd(t.overageCents)} time` : "Amount"}
          </span>
        </div>
        {t.blockBalanceAfterMinutes !== null && (
          <div className="card tight stat">
            <span className="value">{formatMinutes(t.blockBalanceAfterMinutes)}</span>
            <span className="label">Block balance after this month</span>
          </div>
        )}
      </div>
      {t.nonBillableMinutes > 0 && <p className="subtle">Plus {formatMinutes(t.nonBillableMinutes)} of non-billable time.</p>}

      <MonthActions customerId={customerId} month={month} finalized={d.finalized} canFinalize={month < now} hasEntries={d.entries.length > 0} />

      <section className="stack" aria-labelledby="entries-h">
        <h2 id="entries-h">Time this month</h2>
        {d.entries.length === 0 ? (
          <p className="muted">No time logged for {d.customerName} in {monthLabel(month)}.</p>
        ) : (
          <div className="table-wrap">
            <table className="week-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Technician</th>
                  <th scope="col">Request</th>
                  <th scope="col">Note</th>
                  <th scope="col">Logged</th>
                  <th scope="col">Billed</th>
                </tr>
              </thead>
              <tbody>
                {d.entries.map((e) => (
                  <tr key={e.id}>
                    <td>{e.workDate}</td>
                    <td>{e.userName}</td>
                    <td>{e.ticketId ? <Link href={`/portal/tickets/${e.ticketId}`}>#{e.ticketNumber}</Link> : <span className="subtle">General</span>}</td>
                    <td className="note-cell">{e.note ?? <span className="subtle">{e.ticketTitle}</span>}</td>
                    <td className="mono-text">{formatMinutes(e.minutes)}</td>
                    <td className="mono-text">{e.billable ? formatMinutes(roundEntry(e.minutes, inc)) : "Not billable"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stack" aria-labelledby="plan-h">
        <h2 id="plan-h">Plan</h2>
        {d.finalized && d.contract && <p className="subtle">{monthLabel(month)} was invoiced under “{d.contract.name}”. Changing the plan doesn&apos;t change finalized months.</p>}
        <ContractForm customerId={customerId} contract={d.activeContract} />
      </section>
    </PageTransition>
  );
}
