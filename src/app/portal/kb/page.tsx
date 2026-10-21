import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { capabilities } from "@/lib/authz";
import { AUDIENCE_LABEL, listArticles } from "@/lib/kb/service";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/tickets/schemas";
import { PageTransition } from "@/components/page-transition";
import { Time } from "@/components/time";
import { IconInbox, IconPlus } from "@/components/icons";

export const metadata = { title: "Knowledge base" };

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { principal } = await requirePrincipal("/portal/kb");
  const sp = await searchParams;
  const staff = capabilities(principal).staff;
  const q = (sp.q ?? "").slice(0, 200);
  const category = CATEGORIES.includes(sp.category as Category) ? (sp.category as Category) : undefined;
  const items = await listArticles(principal, { q: q || undefined, category, drafts: staff });
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Answers and how-tos</p>
          <h1>Knowledge base</h1>
        </div>
        {staff && (
          <Link className="btn btn-primary" href="/portal/kb/new" transitionTypes={["nav-forward"]}>
            <IconPlus size={16} /> New article
          </Link>
        )}
      </div>
      <form className="row kb-search" role="search" action="/portal/kb">
        <label htmlFor="kb-q" className="sr-only">Search articles</label>
        <input id="kb-q" name="q" className="input" defaultValue={q} placeholder="Search, for example: printer, password, slow" maxLength={200} />
        <label htmlFor="kb-cat" className="sr-only">Category</label>
        <select id="kb-cat" name="category" className="select" defaultValue={category ?? ""}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
          ))}
        </select>
        <button className="btn" type="submit">Search</button>
      </form>
      {items.length === 0 ? (
        <div className="empty">
          <IconInbox size={28} />
          <p>{q ? "No articles match that. Try fewer or different words, or open a request." : "No articles yet."}</p>
        </div>
      ) : (
        <ul className="ticket-list" role="list">
          {items.map((a) => (
            <li key={a.id}>
              <Link className="ticket-row" href={`/portal/kb/${a.id}`} transitionTypes={["nav-forward"]}>
                <div>
                  <div className="title">{a.title}</div>
                  <div className="meta">
                    <span>{CATEGORY_LABEL[a.category]}</span>
                    {a.summary && <span>{a.summary}</span>}
                    <span>Updated <Time iso={a.updatedAt} /></span>
                  </div>
                </div>
                <div className="row">
                  {a.status === "draft" && <span className="badge status-waiting">Draft</span>}
                  {staff && <span className="badge">{a.audience === "customer" && a.customerName ? a.customerName : AUDIENCE_LABEL[a.audience]}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageTransition>
  );
}
