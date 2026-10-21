import { z } from "zod";
import { withUser, type Queryable } from "../db";
import { customersWhere, isStaffAnywhere, isStaffFor, STAFF_ROLES, type Principal } from "../authz";
import { AppError, forbidden, notFound } from "../errors";
import { CATEGORY_LABEL, type Category, type Status } from "../tickets/schemas";

/**
 * Problem management. A problem is the underlying cause behind one or more
 * requests. It moves from investigating, to known error (cause and
 * workaround known), to resolved (permanent fix in place). Technicians only;
 * customers never see problems, only the knowledge article a workaround can
 * be published as.
 */
export type ProblemStatus = "investigating" | "known_error" | "resolved";
export const PROBLEM_STATUS_LABEL: Record<ProblemStatus, string> = {
  investigating: "Investigating",
  known_error: "Known error",
  resolved: "Resolved",
};

export interface ProblemSummary {
  id: string;
  number: number;
  customerId: string | null;
  customerName: string | null;
  title: string;
  status: ProblemStatus;
  ownerName: string | null;
  ticketCount: number;
  updatedAt: string;
}

export interface ProblemDetail extends ProblemSummary {
  description: string;
  rootCause: string;
  workaround: string;
  permanentFix: string;
  ownerUserId: string | null;
  kbArticleId: string | null;
  version: number;
  tickets: { id: string; number: number; title: string; status: Status; customerName: string }[];
}

const iso = (v: unknown) => new Date(v as string).toISOString();
const canWork = (p: Principal, customerId: string | null) => (customerId ? isStaffFor(p, customerId) : isStaffAnywhere(p));

const SUMMARY = `select p.id, p.number, p.customer_id, c.name as customer_name, p.title, p.status, u.display_name as owner_name, p.updated_at,
  (select count(*) from tickets t where t.problem_id = p.id) as ticket_count
  from problems p left join customers c on c.id = p.customer_id left join users u on u.id = p.owner_user_id`;

function toSummary(r: Record<string, unknown>): ProblemSummary {
  return {
    id: r.id as string,
    number: Number(r.number),
    customerId: (r.customer_id as string) ?? null,
    customerName: (r.customer_name as string) ?? null,
    title: r.title as string,
    status: r.status as ProblemStatus,
    ownerName: (r.owner_name as string) ?? null,
    ticketCount: Number(r.ticket_count),
    updatedAt: iso(r.updated_at),
  };
}

export async function listProblems(p: Principal, opts: { open?: boolean; customerId?: string } = {}): Promise<ProblemSummary[]> {
  if (!isStaffAnywhere(p)) return [];
  return withUser(p.userId, async (tx) => {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.open) where.push("p.status <> 'resolved'");
    if (opts.customerId) {
      params.push(opts.customerId);
      where.push(`(p.customer_id is null or p.customer_id = $${params.length})`);
    }
    const r = await tx.query(`${SUMMARY} ${where.length ? `where ${where.join(" and ")}` : ""} order by p.status = 'resolved', p.updated_at desc limit 200`, params);
    return r.rows.map(toSummary);
  });
}

async function load(tx: Queryable, p: Principal, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Problem");
  const r = await tx.query(`${SUMMARY.replace("select p.id,", "select p.*, p.id,")} where p.id = $1`, [id]);
  const row = r.rows[0];
  if (!row) throw notFound("Problem");
  return row;
}

export async function getProblem(p: Principal, id: string): Promise<ProblemDetail> {
  if (!isStaffAnywhere(p)) throw notFound("Problem");
  return withUser(p.userId, async (tx) => {
    const r = await load(tx, p, id);
    const t = await tx.query<{ id: string; number: string; title: string; status: Status; name: string }>(
      "select t.id, t.number, t.title, t.status, c.name from tickets t join customers c on c.id = t.customer_id where t.problem_id = $1 order by t.number desc",
      [id],
    );
    return {
      ...toSummary(r),
      description: r.description as string,
      rootCause: r.root_cause as string,
      workaround: r.workaround as string,
      permanentFix: r.permanent_fix as string,
      ownerUserId: (r.owner_user_id as string) ?? null,
      kbArticleId: (r.kb_article_id as string) ?? null,
      version: Number(r.version),
      tickets: t.rows.map((x) => ({ id: x.id, number: Number(x.number), title: x.title, status: x.status, customerName: x.name })),
    };
  });
}

const text = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\r\n/g, "\n").trim())
    .pipe(z.string().max(max));

export const problemSchema = z.object({
  customerId: z.uuid().nullable(),
  title: z.string().trim().min(3).max(200),
  description: text(20000).default(""),
  status: z.enum(["investigating", "known_error", "resolved"]).default("investigating"),
  rootCause: text(20000).default(""),
  workaround: text(20000).default(""),
  permanentFix: text(20000).default(""),
  ownerUserId: z.uuid().nullable().default(null),
  expectedVersion: z.number().int().positive().optional(),
});

function checkStatus(v: z.infer<typeof problemSchema>) {
  if (v.status === "known_error" && (!v.rootCause || !v.workaround)) {
    throw new AppError(422, "validation_failed", "A known error needs its root cause and a workaround.", { field: "workaround" });
  }
  if (v.status === "resolved" && !v.permanentFix) throw new AppError(422, "validation_failed", "Describe the permanent fix to resolve the problem.", { field: "permanentFix" });
}

export async function createProblem(p: Principal, raw: unknown) {
  const v = problemSchema.parse(raw);
  if (!canWork(p, v.customerId)) throw forbidden("Only technicians can record problems.");
  checkStatus(v);
  return withUser(p.userId, async (tx) => {
    const r = await tx.query<{ id: string; number: string }>(
      `insert into problems (customer_id, title, description, status, root_cause, workaround, permanent_fix, owner_user_id, created_by, resolved_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, case when $4 = 'resolved' then now() end) returning id, number`,
      [v.customerId, v.title, v.description, v.status, v.rootCause, v.workaround, v.permanentFix, v.ownerUserId ?? p.userId, p.userId],
    );
    await tx.query("insert into audit_events (actor_user_id, customer_id, action, target_type, target_id) values ($1, $2, 'problem.create', 'problem', $3)", [p.userId, v.customerId, r.rows[0].id]);
    return { id: r.rows[0].id, number: Number(r.rows[0].number) };
  });
}

export async function updateProblem(p: Principal, id: string, raw: unknown) {
  const v = problemSchema.parse(raw);
  checkStatus(v);
  return withUser(p.userId, async (tx) => {
    const cur = await load(tx, p, id);
    if (!canWork(p, (cur.customer_id as string) ?? null) || !canWork(p, v.customerId)) throw forbidden("Only technicians can update problems.");
    const u = await tx.query<{ version: number }>(
      `update problems set customer_id = $2, title = $3, description = $4, status = $5, root_cause = $6, workaround = $7, permanent_fix = $8,
              owner_user_id = $9, updated_at = now(), version = version + 1,
              resolved_at = case when $5 = 'resolved' then coalesce(resolved_at, now()) else null end
        where id = $1 and ($10::int is null or version = $10) returning version`,
      [id, v.customerId, v.title, v.description, v.status, v.rootCause, v.workaround, v.permanentFix, v.ownerUserId, v.expectedVersion ?? null],
    );
    if (!u.rows[0]) throw new AppError(409, "version_conflict", "Someone else updated this problem. Reload to see the latest changes.");
    if (v.customerId) {
      // Tickets of other customers can't stay linked to a single-customer problem.
      await tx.query("update tickets set problem_id = null where problem_id = $1 and customer_id <> $2", [id, v.customerId]);
    }
    await tx.query("insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'problem.update', 'problem', $3, $4)", [
      p.userId,
      v.customerId,
      id,
      JSON.stringify({ status: v.status }),
    ]);
    return { version: Number(u.rows[0].version) };
  });
}

const linkSchema = z.object({ ticketId: z.uuid(), remove: z.boolean().default(false) });

export async function linkProblemTicket(p: Principal, problemId: string, raw: unknown) {
  const { ticketId, remove } = linkSchema.parse(raw);
  return withUser(p.userId, async (tx) => {
    const t = await tx.query<{ customer_id: string }>("select customer_id from tickets where id = $1", [ticketId]);
    const c = t.rows[0]?.customer_id;
    if (!c || !p.memberships.some((m) => m.customerId === c)) throw notFound("Ticket");
    if (!isStaffFor(p, c)) throw forbidden("Only technicians can link problems.");
    const prob = await tx.query<{ customer_id: string | null }>("select customer_id from problems where id = $1", [problemId]);
    if (!prob.rows[0]) throw notFound("Problem");
    if (prob.rows[0].customer_id && prob.rows[0].customer_id !== c) throw new AppError(422, "validation_failed", "That problem belongs to another client.", { field: "problemId" });
    await tx.query("update tickets set problem_id = $2, updated_at = now(), version = version + 1 where id = $1", [ticketId, remove ? null : problemId]);
    await tx.query("insert into ticket_events (ticket_id, customer_id, actor_user_id, kind) values ($1, $2, $3, $4)", [ticketId, c, p.userId, remove ? "problem_unlinked" : "problem_linked"]);
    return { ok: true };
  });
}

/**
 * Publishes the workaround as a draft knowledge article (for the problem's
 * customer, or all clients), linked back to the problem. A technician reviews
 * and publishes it from the article editor.
 */
export async function draftWorkaroundArticle(p: Principal, problemId: string) {
  return withUser(p.userId, async (tx) => {
    const r = await load(tx, p, problemId);
    if (!canWork(p, (r.customer_id as string) ?? null)) throw forbidden();
    if (!String(r.workaround).trim()) throw new AppError(422, "validation_failed", "Write the workaround first.", { field: "workaround" });
    if (r.kb_article_id) return { articleId: r.kb_article_id as string };
    const a = await tx.query<{ id: string }>(
      `insert into kb_articles (title, summary, body, category, audience, customer_id, status, author_user_id, updated_by)
       values ($1, $2, $3, 'general', $4, $5, 'draft', $6, $6) returning id`,
      [
        `Known issue: ${r.title}`.slice(0, 200),
        "A known issue and how to work around it until it's fixed.",
        `## What's happening\n\n${String(r.description || r.title)}\n\n## Workaround\n\n${r.workaround}`,
        r.customer_id ? "customer" : "everyone",
        r.customer_id ?? null,
        p.userId,
      ],
    );
    await tx.query("update problems set kb_article_id = $2, updated_at = now() where id = $1", [problemId, a.rows[0].id]);
    return { articleId: a.rows[0].id };
  });
}

/** Clusters of recent requests (same customer and category, last 30 days, 3 or more) not tied to a problem. */
export async function repeatIssues(p: Principal) {
  const customers = customersWhere(p, (r) => STAFF_ROLES.includes(r));
  if (!customers.length) return [];
  return withUser(p.userId, async (tx) => {
    const r = await tx.query<{ customer_id: string; name: string; category: Category; n: string; sample: string[] }>(
      `select t.customer_id, c.name, t.category, count(*) as n, (array_agg(t.title order by t.created_at desc))[1:3] as sample
         from tickets t join customers c on c.id = t.customer_id
        where t.customer_id = any($1::uuid[]) and t.created_at > now() - interval '30 days' and t.problem_id is null
          and t.merged_into_ticket_id is null and t.kind = 'incident'
        group by t.customer_id, c.name, t.category having count(*) >= 3 order by count(*) desc limit 10`,
      [customers],
    );
    return r.rows.map((x) => ({ customerId: x.customer_id, customerName: x.name, category: x.category, label: CATEGORY_LABEL[x.category], count: Number(x.n), sample: x.sample }));
  });
}

/** Open problems a request could be linked to (its customer's, plus cross-customer ones). */
export async function problemsForCustomer(p: Principal, customerId: string) {
  if (!isStaffFor(p, customerId)) return [];
  return (await listProblems(p, { open: true, customerId })).map((x) => ({ id: x.id, number: x.number, title: x.title }));
}
