import { requirePrincipal } from "@/lib/auth/current";
import { isStaffAnywhere } from "@/lib/authz";
import { listRecurring, recurringOptions } from "@/lib/recurring/service";
import { todayPacific } from "@/lib/billing/service";
import { PageTransition } from "@/components/page-transition";
import { RecurringConsole } from "./console";

export const metadata = { title: "Recurring requests" };

export default async function RecurringPage() {
  const { principal } = await requirePrincipal("/portal/recurring");
  if (!principal.isOperator && !isStaffAnywhere(principal)) {
    return (
      <PageTransition>
        <h1>Recurring requests</h1>
        <p className="muted">Only technicians can see recurring requests.</p>
      </PageTransition>
    );
  }
  const [rows, options] = await Promise.all([listRecurring(principal), recurringOptions(principal)]);
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Service management</p>
          <h1>Recurring requests</h1>
        </div>
      </div>
      <p className="subtle">
        Maintenance that happens on a schedule opens a request by itself on each date (Pacific time), with the checklist as tasks. Service levels,
        assignment rules and notifications apply as for any request. Platform operators and the client&apos;s service managers can change these.
      </p>
      <RecurringConsole rows={rows} options={options} today={todayPacific()} />
    </PageTransition>
  );
}
