import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { capabilities, customersWhere, STAFF_ROLES } from "@/lib/authz";
import { listAlerts, type Severity } from "@/lib/monitoring/service";
import { PageTransition } from "@/components/page-transition";
import { Time } from "@/components/time";
import { IconAlert, IconCheck, IconInfo } from "@/components/icons";

export const metadata = { title: "Alerts" };

const SEVERITY: Record<Severity, { label: string; cls: string; Icon: typeof IconAlert }> = {
  critical: { label: "Critical", cls: "compliance-error", Icon: IconAlert },
  warning: { label: "Warning", cls: "compliance-inGracePeriod", Icon: IconAlert },
  info: { label: "Info", cls: "", Icon: IconInfo },
};

export default async function AlertsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { principal } = await requirePrincipal("/portal/alerts");
  if (!capabilities(principal).staff) {
    return (
      <PageTransition>
        <h1>Alerts</h1>
        <p className="muted">Monitoring alerts are for technicians.</p>
      </PageTransition>
    );
  }
  const sp = await searchParams;
  const status = sp.status === "resolved" ? "resolved" : "open";
  const alerts = await listAlerts(principal, { status });
  const multi = customersWhere(principal, (r) => STAFF_ROLES.includes(r)).length > 1;

  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Service desk</p>
          <h1>Alerts</h1>
        </div>
        {principal.isOperator && (
          <Link className="btn" href="/portal/admin/monitoring" transitionTypes={["nav-forward"]}>Monitoring settings</Link>
        )}
      </div>
      <p className="subtle">
        Problems found by monitoring: Intune compliance, devices that stopped checking in, warranties ending, licenses running out, and alerts from
        connected tools. Each opens one request; repeats are counted on it, and it updates when the problem clears.
      </p>
      <div className="tabs" role="group" aria-label="Show">
        <Link href="/portal/alerts" aria-current={status === "open" ? "page" : undefined} className="tab-link" scroll={false}>Open</Link>
        <Link href="/portal/alerts?status=resolved" aria-current={status === "resolved" ? "page" : undefined} className="tab-link" scroll={false}>Cleared</Link>
      </div>
      {alerts.length === 0 ? (
        <div className="empty">
          <IconCheck size={28} />
          <p>{status === "open" ? "No open alerts. Everything monitoring checks looks fine." : "No cleared alerts yet."}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Alert</th>
                {multi && <th scope="col">Client</th>}
                <th scope="col">Source</th>
                <th scope="col">Seen</th>
                <th scope="col">{status === "open" ? "Last seen" : "Cleared"}</th>
                <th scope="col">Request</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => {
                const s = SEVERITY[a.severity];
                return (
                  <tr key={a.id}>
                    <th scope="row">
                      <span className={`badge ${s.cls}`}>
                        <s.Icon size={13} /> {s.label}
                      </span>{" "}
                      {a.title}
                    </th>
                    {multi && <td>{a.customerName}</td>}
                    <td>{a.sourceLabel}</td>
                    <td className="mono-text">{a.occurrences === 1 ? "once" : `${a.occurrences} times`}</td>
                    <td>
                      <Time iso={status === "open" ? a.lastSeenAt : (a.resolvedAt ?? a.lastSeenAt)} />
                    </td>
                    <td>{a.ticketId ? <Link href={`/portal/tickets/${a.ticketId}`}>#{a.ticketNumber}</Link> : <span className="subtle">Not ticketed</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageTransition>
  );
}
