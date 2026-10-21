import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePrincipal } from "@/lib/auth/current";
import { PROBLEM_STATUS_LABEL, getProblem } from "@/lib/problems/service";
import { problemPickers } from "@/lib/problems/pickers";
import { AppError } from "@/lib/errors";
import { STATUS_LABEL } from "@/lib/tickets/schemas";
import { PageTransition } from "@/components/page-transition";
import { IconBack } from "@/components/icons";
import { ProblemEditor } from "../editor";

export const metadata = { title: "Problem" };

export default async function ProblemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { principal } = await requirePrincipal(`/portal/problems/${id}`);
  let p;
  try {
    p = await getProblem(principal, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const { customers, staff } = await problemPickers(principal);
  return (
    <PageTransition>
      <p>
        <Link href="/portal/problems" transitionTypes={["nav-back"]} className="subtle">
          <IconBack size={14} /> Problems
        </Link>
      </p>
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <span className="ticket-number">PRB-{p.number}</span> · {p.customerName ?? "Several clients"} · technicians only
          </p>
          <h1>{p.title}</h1>
          <span className={`badge problem-${p.status}`}>{PROBLEM_STATUS_LABEL[p.status]}</span>
        </div>
      </div>
      <div className="detail-grid">
        <ProblemEditor
          customers={customers}
          staff={staff}
          initial={{
            id: p.id,
            customerId: p.customerId,
            title: p.title,
            description: p.description,
            status: p.status,
            rootCause: p.rootCause,
            workaround: p.workaround,
            permanentFix: p.permanentFix,
            ownerUserId: p.ownerUserId,
            version: p.version,
            kbArticleId: p.kbArticleId,
          }}
        />
        <aside className="stack" aria-label="Linked requests">
          <section className="card tight stack">
            <h2 className="eyebrow">Linked requests ({p.tickets.length})</h2>
            {p.tickets.length === 0 ? (
              <p className="subtle">Link requests from their ticket page.</p>
            ) : (
              <ul className="stack" role="list">
                {p.tickets.map((t) => (
                  <li key={t.id}>
                    <Link href={`/portal/tickets/${t.id}`}>#{t.number} {t.title}</Link>{" "}
                    <span className="subtle">({STATUS_LABEL[t.status]}{p.customerId ? "" : ` · ${t.customerName}`})</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </PageTransition>
  );
}
