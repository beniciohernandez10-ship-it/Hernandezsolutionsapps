import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { isStaffAnywhere } from "@/lib/authz";
import { PROBLEM_STATUS_LABEL, listProblems, repeatIssues } from "@/lib/problems/service";
import { PageTransition } from "@/components/page-transition";
import { Time } from "@/components/time";
import { IconInbox, IconPlus } from "@/components/icons";

export const metadata = { title: "Problems" };

export default async function ProblemsPage() {
  const { principal } = await requirePrincipal("/portal/problems");
  if (!isStaffAnywhere(principal)) {
    return (
      <PageTransition>
        <h1>Problems</h1>
        <p className="muted">Problem management is for technicians.</p>
      </PageTransition>
    );
  }
  const [items, repeats] = await Promise.all([listProblems(principal), repeatIssues(principal)]);
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Technicians · root causes behind repeat issues</p>
          <h1>Problems</h1>
        </div>
        <Link className="btn btn-primary" href="/portal/problems/new" transitionTypes={["nav-forward"]}>
          <IconPlus size={16} /> Record a problem
        </Link>
      </div>
      {repeats.length > 0 && (
        <section className="card stack" aria-labelledby="rep-h">
          <h2 id="rep-h">Repeat issues in the last 30 days</h2>
          <p className="subtle">Three or more similar requests from one client that aren&apos;t linked to a problem yet.</p>
          <ul className="stack" role="list">
            {repeats.map((r) => (
              <li key={`${r.customerId}-${r.category}`} className="spread">
                <span>
                  <strong>{r.count}</strong> {r.label} requests · {r.customerName}
                  <span className="subtle"> · e.g. {r.sample.join("; ")}</span>
                </span>
                <Link className="btn btn-ghost" href={`/portal/tickets?customerId=${r.customerId}&q=`}>View requests</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {items.length === 0 ? (
        <div className="empty">
          <IconInbox size={28} />
          <p>No problems recorded.</p>
        </div>
      ) : (
        <ul className="ticket-list" role="list">
          {items.map((p) => (
            <li key={p.id}>
              <Link className="ticket-row" href={`/portal/problems/${p.id}`} transitionTypes={["nav-forward"]}>
                <div>
                  <div className="title">{p.title}</div>
                  <div className="meta">
                    <span className="ticket-number">PRB-{p.number}</span>
                    <span>{p.customerName ?? "Several clients"}</span>
                    <span>{p.ticketCount} linked request{p.ticketCount === 1 ? "" : "s"}</span>
                    {p.ownerName && <span>Owner {p.ownerName}</span>}
                    <span>Updated <Time iso={p.updatedAt} /></span>
                  </div>
                </div>
                <div className="row">
                  <span className={`badge problem-${p.status}`}>{PROBLEM_STATUS_LABEL[p.status]}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageTransition>
  );
}
