import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePrincipal } from "@/lib/auth/current";
import { AUDIENCE_LABEL, getArticle } from "@/lib/kb/service";
import { AppError } from "@/lib/errors";
import { CATEGORY_LABEL } from "@/lib/tickets/schemas";
import { PageTransition } from "@/components/page-transition";
import { Markdown } from "@/components/markdown";
import { Time } from "@/components/time";
import { IconBack } from "@/components/icons";
import { Feedback } from "./feedback";

export const metadata = { title: "Article" };

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { principal } = await requirePrincipal(`/portal/kb/${id}`);
  let a;
  try {
    a = await getArticle(principal, id, { recordView: true });
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  return (
    <PageTransition>
      <p>
        <Link href="/portal/kb" transitionTypes={["nav-back"]} className="subtle">
          <IconBack size={14} /> Knowledge base
        </Link>
      </p>
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {CATEGORY_LABEL[a.category]}
            {a.canEdit && <> · {a.audience === "customer" && a.customerName ? a.customerName : AUDIENCE_LABEL[a.audience]}</>}
            {a.status === "draft" && " · Draft"}
          </p>
          <h1>{a.title}</h1>
          {a.summary && <p className="muted">{a.summary}</p>}
        </div>
        {a.canEdit && (
          <Link className="btn" href={`/portal/kb/${a.id}/edit`} transitionTypes={["nav-forward"]}>Edit</Link>
        )}
      </div>
      <article className="card">
        <Markdown source={a.body} />
      </article>
      <p className="subtle">
        Updated <Time iso={a.updatedAt} mode="absolute" />
        {a.canEdit && ` · ${a.views} views · ${a.helpful} found it helpful · ${a.notHelpful} didn't`}
      </p>
      {a.status === "published" && <Feedback id={a.id} initial={a.myFeedback} />}
    </PageTransition>
  );
}
