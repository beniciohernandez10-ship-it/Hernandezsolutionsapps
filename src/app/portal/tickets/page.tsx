import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { capabilities } from "@/lib/authz";
import { listTickets } from "@/lib/tickets/service";
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from "@/lib/tickets/schemas";
import { PageTransition } from "@/components/page-transition";
import { TicketList } from "./ticket-list";
import { IconPlus } from "@/components/icons";

export const metadata = { title: "Tickets" };

type SP = Record<string, string | undefined>;

export default async function TicketsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { principal } = await requirePrincipal("/portal/tickets");
  const caps = capabilities(principal);
  const filters = {
    q: sp.q?.slice(0, 200) || undefined,
    status: (sp.status && [...STATUSES, "active"].includes(sp.status) ? sp.status : undefined) as never,
    priority: (sp.priority && (PRIORITIES as readonly string[]).includes(sp.priority) ? sp.priority : undefined) as never,
    assigned: (sp.assigned === "me" || sp.assigned === "unassigned" ? sp.assigned : undefined) as never,
    customerId: principal.memberships.some((m) => m.customerId === sp.customerId) ? sp.customerId : undefined,
    page: Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1),
    pageSize: 20,
  };
  const result = await listTickets(principal, filters);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const qs = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, page })) if (v !== undefined && k !== "pageSize") p.set(k, String(v));
    return `/portal/tickets?${p.toString()}`;
  };
  const filtered = Boolean(filters.q || filters.status || filters.priority || filters.assigned || filters.customerId);
  return (
    <PageTransition>
      <div className="page-head">
        <h1>{caps.staff ? "Tickets" : "My requests"}</h1>
        {caps.canCreate && (
          <Link className="btn btn-primary" href="/portal/tickets/new" transitionTypes={["nav-forward"]}>
            <IconPlus size={16} /> New request
          </Link>
        )}
      </div>
      <form className="filters card tight" role="search" action="/portal/tickets">
        <div className="field">
          <label htmlFor="q">Search</label>
          <input id="q" name="q" className="input" defaultValue={filters.q} placeholder="Title, description or #number" />
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" className="select" defaultValue={filters.status ?? ""}>
            <option value="">Any status</option>
            <option value="active">Not resolved</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="priority">Priority</label>
          <select id="priority" name="priority" className="select" defaultValue={filters.priority ?? ""}>
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>
        </div>
        {principal.memberships.length > 1 && (
          <div className="field">
            <label htmlFor="customerId">Organization</label>
            <select id="customerId" name="customerId" className="select" defaultValue={filters.customerId ?? ""}>
              <option value="">All organizations</option>
              {principal.memberships.map((m) => (
                <option key={m.customerId} value={m.customerId}>{m.customerName}</option>
              ))}
            </select>
          </div>
        )}
        {caps.staff && (
          <div className="field">
            <label htmlFor="assigned">Assignment</label>
            <select id="assigned" name="assigned" className="select" defaultValue={filters.assigned ?? ""}>
              <option value="">Anyone</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
        )}
        <div className="row">
          <button className="btn btn-primary" type="submit">Apply</button>
          {filtered && <Link className="btn btn-ghost" href="/portal/tickets">Clear</Link>}
        </div>
      </form>
      <p className="subtle" aria-live="polite">
        {result.total} ticket{result.total === 1 ? "" : "s"}
        {filtered ? " match your filters" : ""}
      </p>
      <TicketList
        items={result.items}
        showCustomer={principal.memberships.length > 1}
        emptyText={filtered ? "No tickets match these filters." : "No requests yet. Use New request to ask for help."}
      />
      {pages > 1 && (
        <nav className="pagination" aria-label="Pagination">
          {filters.page > 1 ? <Link className="btn" href={qs(filters.page - 1)} transitionTypes={["nav-back"]}>Previous</Link> : <span />}
          <span className="subtle">Page {filters.page} of {pages}</span>
          {filters.page < pages ? <Link className="btn" href={qs(filters.page + 1)} transitionTypes={["nav-forward"]}>Next</Link> : <span />}
        </nav>
      )}
    </PageTransition>
  );
}
