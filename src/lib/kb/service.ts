import { z } from "zod";
import { withUser } from "../db";
import { isStaffAnywhere, isStaffFor, type Principal } from "../authz";
import { AppError, forbidden, notFound } from "../errors";
import { CATEGORIES, type Category } from "../tickets/schemas";

/**
 * Knowledge base. Visibility is enforced by row-level security
 * (app_kb_visible) and mirrored here for clear errors:
 * - everyone: any signed-in member of any customer;
 * - customer: members of that customer;
 * - staff: technicians (of that customer, or any technician);
 * - drafts: only people who may edit the article.
 */

export type Audience = "everyone" | "customer" | "staff";

export interface ArticleSummary {
  id: string;
  title: string;
  summary: string;
  category: Category;
  audience: Audience;
  customerId: string | null;
  customerName: string | null;
  status: "draft" | "published";
  updatedAt: string;
  helpful: number;
  notHelpful: number;
  views: number;
}

export interface Article extends ArticleSummary {
  body: string;
  authorName: string | null;
  canEdit: boolean;
  myFeedback: boolean | null;
}

const iso = (v: unknown) => new Date(v as string).toISOString();

function toSummary(r: Record<string, unknown>): ArticleSummary {
  return {
    id: r.id as string,
    title: r.title as string,
    summary: r.summary as string,
    category: r.category as Category,
    audience: r.audience as Audience,
    customerId: (r.customer_id as string) ?? null,
    customerName: (r.customer_name as string) ?? null,
    status: r.status as "draft" | "published",
    updatedAt: iso(r.updated_at),
    helpful: Number(r.helpful),
    notHelpful: Number(r.not_helpful),
    views: Number(r.views),
  };
}

const canWrite = (p: Principal, customerId: string | null) => (customerId ? isStaffFor(p, customerId) : isStaffAnywhere(p));

/** Words for an OR-style full-text query, so partial descriptions still find articles. */
function orQuery(q: string) {
  const words = [...new Set(q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].slice(0, 12);
  return words.length ? words.join(" | ") : null;
}

export const listSchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.enum(CATEGORIES).optional(),
  drafts: z.coerce.boolean().optional(),
});

export async function listArticles(p: Principal, raw: unknown = {}): Promise<ArticleSummary[]> {
  const f = listSchema.parse(raw);
  if (!p.memberships.length) return [];
  return withUser(p.userId, async (tx) => {
    const params: unknown[] = [];
    const where: string[] = [];
    if (!f.drafts) where.push("a.status = 'published'");
    if (f.category) {
      params.push(f.category);
      where.push(`a.category = $${params.length}`);
    }
    let rank = "";
    if (f.q) {
      const query = orQuery(f.q);
      if (!query) return [];
      params.push(query);
      where.push(`a.search @@ to_tsquery('english', $${params.length})`);
      rank = `ts_rank(a.search, to_tsquery('english', $${params.length})) desc, `;
    }
    const r = await tx.query(
      `select a.id, a.title, a.summary, a.category, a.audience, a.customer_id, c.name as customer_name, a.status, a.updated_at,
              a.helpful, a.not_helpful, a.views
         from kb_articles a left join customers c on c.id = a.customer_id
        ${where.length ? `where ${where.join(" and ")}` : ""}
        order by ${rank}a.updated_at desc limit 100`,
      params,
    );
    return r.rows.map(toSummary);
  });
}

/** Published articles that might answer a new request. Customers never get technician-only articles. */
export async function suggestArticles(p: Principal, q: string, limit = 5): Promise<ArticleSummary[]> {
  const query = orQuery(q);
  if (!query || !p.memberships.length) return [];
  return withUser(p.userId, async (tx) => {
    const r = await tx.query(
      `select a.id, a.title, a.summary, a.category, a.audience, a.customer_id, null as customer_name, a.status, a.updated_at,
              a.helpful, a.not_helpful, a.views
         from kb_articles a
        where a.status = 'published' and a.audience <> 'staff' and a.search @@ to_tsquery('english', $1)
        order by ts_rank(a.search, to_tsquery('english', $1)) desc limit $2`,
      [query, Math.min(Math.max(limit, 1), 10)],
    );
    return r.rows.map(toSummary);
  });
}

export async function getArticle(p: Principal, id: string, opts: { recordView?: boolean } = {}): Promise<Article> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Article");
  return withUser(p.userId, async (tx) => {
    const r = await tx.query(
      `select a.*, c.name as customer_name, u.display_name as author_name
         from kb_articles a left join customers c on c.id = a.customer_id left join users u on u.id = a.author_user_id
        where a.id = $1`,
      [id],
    );
    const a = r.rows[0];
    if (!a) throw notFound("Article");
    if (opts.recordView && a.status === "published") await tx.query("select app_kb_record_view($1)", [id]);
    const fb = await tx.query<{ helpful: boolean }>("select helpful from kb_feedback where article_id = $1 and user_id = $2", [id, p.userId]);
    return {
      ...toSummary(a),
      body: a.body as string,
      authorName: (a.author_name as string) ?? null,
      canEdit: canWrite(p, (a.customer_id as string) ?? null),
      myFeedback: fb.rows[0]?.helpful ?? null,
    };
  });
}

export const articleSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    summary: z.string().trim().max(300).default(""),
    body: z
      .string()
      .transform((s) => s.replace(/\r\n/g, "\n").trim())
      .pipe(z.string().min(1, { error: "Write the article." }).max(50000)),
    category: z.enum(CATEGORIES),
    audience: z.enum(["everyone", "customer", "staff"]),
    customerId: z.uuid().nullable(),
    status: z.enum(["draft", "published"]),
  })
  .refine((a) => a.audience !== "customer" || a.customerId, { error: "Choose the customer this article is for.", path: ["customerId"] })
  .refine((a) => a.audience === "customer" || a.audience === "staff" || !a.customerId, {
    error: "Articles for everyone aren't tied to one customer.",
    path: ["customerId"],
  });

export async function saveArticle(p: Principal, id: string | null, raw: unknown) {
  const v = articleSchema.parse(raw);
  if (!canWrite(p, v.customerId)) throw forbidden("Only technicians can write articles here.");
  return withUser(p.userId, async (tx) => {
    if (id) {
      const cur = await tx.query<{ customer_id: string | null }>("select customer_id from kb_articles where id = $1", [id]);
      if (!cur.rows[0]) throw notFound("Article");
      if (!canWrite(p, cur.rows[0].customer_id)) throw forbidden("Only technicians can write articles here.");
      const u = await tx.query(
        `update kb_articles set title = $2, summary = $3, body = $4, category = $5, audience = $6, customer_id = $7, status = $8,
                updated_by = $9, updated_at = now(), published_at = case when $8 = 'published' then coalesce(published_at, now()) else published_at end
          where id = $1 returning id`,
        [id, v.title, v.summary, v.body, v.category, v.audience, v.customerId, v.status, p.userId],
      );
      if (!u.rowCount) throw notFound("Article");
    } else {
      const r = await tx.query<{ id: string }>(
        `insert into kb_articles (title, summary, body, category, audience, customer_id, status, author_user_id, updated_by, published_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8, case when $7 = 'published' then now() end) returning id`,
        [v.title, v.summary, v.body, v.category, v.audience, v.customerId, v.status, p.userId],
      );
      id = r.rows[0].id;
    }
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'kb.save', 'kb_article', $3, $4)",
      [p.userId, v.customerId, id, JSON.stringify({ status: v.status, audience: v.audience })],
    );
    return { id };
  });
}

export async function articleFeedback(p: Principal, id: string, helpful: boolean) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Article");
  try {
    await withUser(p.userId, (tx) => tx.query("select app_kb_feedback($1, $2)", [id, helpful]));
  } catch (err) {
    if ((err as { code?: string }).code === "42501") throw notFound("Article");
    throw err;
  }
  return { ok: true };
}

export const AUDIENCE_LABEL: Record<Audience, string> = { everyone: "All clients", customer: "One client", staff: "Technicians only" };

export function assertKbWriter(p: Principal) {
  if (!isStaffAnywhere(p)) throw new AppError(403, "forbidden", "Only technicians can write articles.");
}
