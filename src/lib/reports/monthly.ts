import { asSystem, type Queryable } from "../db";
import { requireOperator, type Principal } from "../authz";
import { config } from "../config";
import { AppError, notFound } from "../errors";
import { log, errorSummary } from "../log";
import { PRIORITIES, type Category, type Priority } from "../tickets/schemas";
import { csvCell, currentMonth, monthRange, reportSchema, REPORT_TZ } from "./service";

/**
 * Month-end client reports for operators to send to each client's owners:
 * every request resolved in the month with how it was solved, who solved it
 * and whether it met its service-level target, plus what the requests were
 * about. The data is frozen when the report is generated; the daily cron
 * generates last month's report for every active client once the month ends.
 */

type Target = "met" | "missed" | "none";

export interface MonthlyReport {
  version: 1;
  customerId: string;
  customerName: string;
  month: string;
  timeZone: string;
  generatedAt: string;
  summary: {
    opened: number;
    resolved: number;
    stillOpen: number;
    medianFirstResponseMinutes: number | null;
    medianResolutionHours: number | null;
    /** Resolved requests that had a resolution target, and how many met it. */
    slaTracked: number;
    slaMet: number;
    slaMissed: number;
    satisfactionGood: number;
    satisfactionBad: number;
  };
  byCategory: { category: Category; count: number }[];
  byPriority: { priority: Priority; count: number }[];
  byTechnician: { name: string; count: number }[];
  resolvedTickets: {
    number: number;
    title: string;
    kind: string;
    category: Category;
    priority: Priority;
    requester: string;
    openedAt: string;
    resolvedAt: string;
    resolvedBy: string | null;
    resolution: string | null;
    hoursToResolve: number;
    resolutionTarget: Target;
    firstResponseTarget: Target;
    rating: "good" | "bad" | null;
  }[];
  openTickets: { number: number; title: string; status: string; priority: Priority; openedAt: string; assignee: string | null }[];
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) => new Date(v as string).toISOString();

function target(done: unknown, due: unknown, breached?: unknown): Target {
  if (!due) return "none";
  if (breached) return "missed";
  if (!done) return new Date(due as string) < new Date() ? "missed" : "none";
  return new Date(done as string) <= new Date(due as string) ? "met" : "missed";
}

/** Gathers the report data for one client and month (system context; callers authorise). */
export async function collectMonthlyReport(tx: Queryable, customerId: string, month: string): Promise<MonthlyReport> {
  const { start, end } = monthRange(month);
  const name = (await tx.query<{ name: string }>("select name from customers where id = $1", [customerId])).rows[0]?.name;
  if (name === undefined) throw notFound("Customer");
  const base = [customerId, start, end];
  const totals = (
    await tx.query<Record<string, string | null>>(
      `select
         count(*) filter (where created_at >= $2 and created_at < $3) as opened,
         count(*) filter (where resolved_at >= $2 and resolved_at < $3) as resolved,
         count(*) filter (where created_at < $3 and status not in ('resolved', 'closed')) as still_open,
         (percentile_cont(0.5) within group (order by extract(epoch from (first_response_at - created_at)) / 60)
            filter (where created_at >= $2 and created_at < $3 and first_response_at is not null)) as med_fr,
         (percentile_cont(0.5) within group (order by extract(epoch from (resolved_at - created_at)) / 3600)
            filter (where resolved_at >= $2 and resolved_at < $3)) as med_res
       from tickets where customer_id = $1 and merged_into_ticket_id is null`,
      base,
    )
  ).rows[0];
  const cat = await tx.query<{ category: Category; n: string }>(
    `select category, count(*) as n from tickets where customer_id = $1 and created_at >= $2 and created_at < $3 and merged_into_ticket_id is null
      group by category order by count(*) desc, category`,
    base,
  );
  const pri = await tx.query<{ priority: Priority; n: string }>(
    `select priority, count(*) as n from tickets where customer_id = $1 and created_at >= $2 and created_at < $3 and merged_into_ticket_id is null group by priority`,
    base,
  );
  // Who resolved it: the person whose status change last set it to resolved.
  const resolved = await tx.query<Record<string, unknown>>(
    `select t.number, t.title, t.kind, t.category, t.priority, ru.display_name as requester, t.created_at, t.resolved_at, t.resolution_note,
            t.first_response_at, t.first_response_due_at, t.resolution_due_at, t.resolution_breached_at, s.rating,
            (select u.display_name from ticket_events e join users u on u.id = e.actor_user_id
              where e.ticket_id = t.id and e.to_value = 'resolved' and e.kind in ('status_changed', 'reopened') and e.created_at <= t.resolved_at + interval '1 minute'
              order by e.created_at desc limit 1) as resolved_by
       from tickets t join users ru on ru.id = t.requester_user_id
       left join ticket_surveys s on s.ticket_id = t.id
      where t.customer_id = $1 and t.resolved_at >= $2 and t.resolved_at < $3 and t.merged_into_ticket_id is null
      order by t.resolved_at, t.number`,
    base,
  );
  const open = await tx.query<Record<string, unknown>>(
    `select t.number, t.title, t.status, t.priority, t.created_at, au.display_name as assignee
       from tickets t left join users au on au.id = t.assignee_user_id
      where t.customer_id = $1 and t.created_at < $2 and t.status not in ('resolved', 'closed') and t.merged_into_ticket_id is null
      order by t.created_at limit 200`,
    [customerId, end],
  );
  const csat = (
    await tx.query<{ good: string; bad: string }>(
      `select count(*) filter (where s.rating = 'good') as good, count(*) filter (where s.rating = 'bad') as bad
         from ticket_surveys s join tickets t on t.id = s.ticket_id
        where s.customer_id = $1 and t.resolved_at >= $2 and t.resolved_at < $3`,
      base,
    )
  ).rows[0];

  const resolvedTickets = resolved.rows.map((r) => ({
    number: num(r.number),
    title: r.title as string,
    kind: r.kind as string,
    category: r.category as Category,
    priority: r.priority as Priority,
    requester: r.requester as string,
    openedAt: iso(r.created_at),
    resolvedAt: iso(r.resolved_at),
    resolvedBy: (r.resolved_by as string) ?? null,
    resolution: (r.resolution_note as string) || null,
    hoursToResolve: Math.round(((new Date(r.resolved_at as string).getTime() - new Date(r.created_at as string).getTime()) / 3_600_000) * 10) / 10,
    resolutionTarget: target(r.resolved_at, r.resolution_due_at, r.resolution_breached_at),
    firstResponseTarget: target(r.first_response_at, r.first_response_due_at),
    rating: (r.rating as "good" | "bad") ?? null,
  }));
  const techs = new Map<string, number>();
  for (const t of resolvedTickets) {
    const k = t.resolvedBy ?? "Not recorded";
    techs.set(k, (techs.get(k) ?? 0) + 1);
  }
  const tracked = resolvedTickets.filter((t) => t.resolutionTarget !== "none");
  return {
    version: 1,
    customerId,
    customerName: name,
    month,
    timeZone: REPORT_TZ,
    generatedAt: new Date().toISOString(),
    summary: {
      opened: num(totals.opened),
      resolved: num(totals.resolved),
      stillOpen: num(totals.still_open),
      medianFirstResponseMinutes: totals.med_fr === null ? null : Math.round(Number(totals.med_fr)),
      medianResolutionHours: totals.med_res === null ? null : Math.round(Number(totals.med_res) * 10) / 10,
      slaTracked: tracked.length,
      slaMet: tracked.filter((t) => t.resolutionTarget === "met").length,
      slaMissed: tracked.filter((t) => t.resolutionTarget === "missed").length,
      satisfactionGood: num(csat.good),
      satisfactionBad: num(csat.bad),
    },
    byCategory: cat.rows.map((r) => ({ category: r.category, count: num(r.n) })),
    byPriority: PRIORITIES.map((p) => ({ priority: p, count: num(pri.rows.find((r) => r.priority === p)?.n) })),
    byTechnician: [...techs].map(([n, count]) => ({ name: n, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    resolvedTickets,
    openTickets: open.rows.map((r) => ({
      number: num(r.number),
      title: r.title as string,
      status: r.status as string,
      priority: r.priority as Priority,
      openedAt: iso(r.created_at),
      assignee: (r.assignee as string) ?? null,
    })),
  };
}

async function save(customerId: string, month: string, by: string | null) {
  return asSystem(async (tx) => {
    const data = await collectMonthlyReport(tx, customerId, month);
    const r = await tx.query<{ id: string }>(
      `insert into monthly_reports (customer_id, month, data, generated_by) values ($1, $2, $3, $4)
       on conflict (customer_id, month) do update set data = excluded.data, generated_at = now(), generated_by = excluded.generated_by
       returning id`,
      [customerId, month, JSON.stringify(data), by],
    );
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'report.generated', 'monthly_report', $3, $4)",
      [by, customerId, r.rows[0].id, JSON.stringify({ month, automatic: by === null })],
    );
    return { id: r.rows[0].id };
  });
}

/** Operator: build (or rebuild) one client's report for a finished or current month. */
export async function runMonthlyReport(p: Principal, raw: unknown) {
  requireOperator(p);
  const { customerId, month } = reportSchema.parse(raw);
  if (month > currentMonth()) throw new AppError(422, "validation_failed", "That month hasn't started yet.");
  return save(customerId, month, p.userId);
}

export const previousMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/**
 * Cron: once a month has ended (in the report time zone), generates its report
 * for every active client that doesn't have one yet. Safe to run daily.
 */
export async function generateDueReports(now = new Date()) {
  const month = previousMonth(currentMonth(now));
  const due = await asSystem((tx) =>
    tx.query<{ id: string }>(
      `select c.id from customers c
        where c.status = 'active' and ($2::boolean or not c.is_demo)
          and not exists (select 1 from monthly_reports r where r.customer_id = c.id and r.month = $1)`,
      [month, config().demoMode],
    ),
  );
  let generated = 0;
  for (const c of due.rows) {
    try {
      await save(c.id, month, null);
      generated++;
    } catch (err) {
      log.error("reports.monthly_failed", { customerId: c.id, month, error: errorSummary(err) });
    }
  }
  return { month, generated };
}

export interface SavedReportSummary {
  id: string;
  customerId: string;
  customerName: string;
  month: string;
  generatedAt: string;
  generatedBy: string | null;
  resolved: number;
  slaMissed: number;
}

export async function listMonthlyReports(p: Principal): Promise<SavedReportSummary[]> {
  requireOperator(p);
  const r = await asSystem((tx) =>
    tx.query<Record<string, unknown>>(
      `select r.id, r.customer_id, c.name, r.month, r.generated_at, u.display_name as generated_by,
              (r.data->'summary'->>'resolved')::int as resolved, (r.data->'summary'->>'slaMissed')::int as sla_missed
         from monthly_reports r join customers c on c.id = r.customer_id left join users u on u.id = r.generated_by
        order by r.month desc, c.name limit 300`,
    ),
  );
  return r.rows.map((x) => ({
    id: x.id as string,
    customerId: x.customer_id as string,
    customerName: x.name as string,
    month: x.month as string,
    generatedAt: iso(x.generated_at),
    generatedBy: (x.generated_by as string) ?? null,
    resolved: num(x.resolved),
    slaMissed: num(x.sla_missed),
  }));
}

export async function getMonthlyReport(p: Principal, id: string) {
  requireOperator(p);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Report");
  const r = await asSystem((tx) =>
    tx.query<{ data: MonthlyReport; generated_at: string; generated_by: string | null }>(
      `select r.data, r.generated_at, u.display_name as generated_by from monthly_reports r left join users u on u.id = r.generated_by where r.id = $1`,
      [id],
    ),
  );
  const row = r.rows[0];
  if (!row) throw notFound("Report");
  return { id, report: row.data, generatedAt: iso(row.generated_at), generatedBy: row.generated_by ?? null };
}

const TARGET_LABEL: Record<Target, string> = { met: "Met", missed: "Missed", none: "No target" };

/** The resolved-request table as CSV (formulas neutralised). */
export async function monthlyReportCsv(p: Principal, id: string) {
  const { report } = await getMonthlyReport(p, id);
  const header = ["Number", "Request", "Type", "Category", "Priority", "Requester", "Opened", "Resolved", "Resolved by", "Hours to resolve", "Resolution target", "First response target", "How it was solved", "Rating"];
  const lines = report.resolvedTickets.map((t) =>
    [t.number, t.title, t.kind, t.category, t.priority, t.requester, t.openedAt, t.resolvedAt, t.resolvedBy ?? "", t.hoursToResolve, TARGET_LABEL[t.resolutionTarget], TARGET_LABEL[t.firstResponseTarget], t.resolution ?? "", t.rating ?? ""]
      .map(csvCell)
      .join(","),
  );
  return { filename: `${report.customerName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${report.month}-service-report.csv`, csv: [header.join(","), ...lines].join("\r\n") };
}
