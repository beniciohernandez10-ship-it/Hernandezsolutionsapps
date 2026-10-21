import { z } from "zod";
import { withUser } from "../db";
import { canSeeOrgFor, isStaffFor, type Principal } from "../authz";
import { forbidden } from "../errors";
import { zonedTime } from "../sla/calendar";
import { CATEGORIES, PRIORITIES, type Category, type Priority } from "../tickets/schemas";

/**
 * Monthly service reports per customer, computed only from ticket data.
 * Client administrators see their own organization's report without SLA
 * targets or individual comments; technicians see everything for customers
 * they're assigned to.
 */

export const reportSchema = z.object({
  customerId: z.uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "Use YYYY-MM." }),
});

export const REPORT_TZ = "America/Los_Angeles";

export function monthRange(month: string, timeZone = REPORT_TZ) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(zonedTime(y, m, 1, 0, 0, timeZone));
  const end = new Date(zonedTime(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1, 0, 0, timeZone));
  return { start, end };
}

export function currentMonth(now = new Date(), timeZone = REPORT_TZ) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}`;
}

export interface Report {
  customerId: string;
  customerName: string;
  month: string;
  timeZone: string;
  staffView: boolean;
  created: number;
  resolved: number;
  openNow: number;
  byCategory: { category: Category; count: number }[];
  byPriority: { priority: Priority; count: number }[];
  requests: number;
  incidents: number;
  daily: { day: string; created: number; resolved: number }[];
  medianFirstResponseMinutes: number | null;
  medianResolutionHours: number | null;
  /** Staff only. */
  sla: { tickets: number; firstResponseMet: number; firstResponseMissed: number; resolutionMet: number; resolutionMissed: number } | null;
  satisfaction: { good: number; bad: number };
  /** Staff only: latest comments with their request numbers. */
  comments: { number: number; rating: "good" | "bad"; comment: string }[];
  topRequesters: { name: string; count: number }[];
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

export async function buildReport(p: Principal, raw: unknown): Promise<Report> {
  const { customerId, month } = reportSchema.parse(raw);
  if (!canSeeOrgFor(p, customerId)) throw forbidden("You can't view reports for this organization.");
  const staffView = isStaffFor(p, customerId);
  const { start, end } = monthRange(month);
  return withUser(p.userId, async (tx) => {
    const name = (await tx.query<{ name: string }>("select name from customers where id = $1", [customerId])).rows[0]?.name ?? "";
    const base = [customerId, start, end];
    const totals = (
      await tx.query<Record<string, string | null>>(
        `select
           count(*) filter (where created_at >= $2 and created_at < $3) as created,
           count(*) filter (where resolved_at >= $2 and resolved_at < $3) as resolved,
           count(*) filter (where status not in ('resolved', 'closed')) as open_now,
           count(*) filter (where created_at >= $2 and created_at < $3 and kind = 'request') as requests,
           count(*) filter (where created_at >= $2 and created_at < $3 and kind = 'incident') as incidents,
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
        group by category order by count(*) desc`,
      base,
    );
    const pri = await tx.query<{ priority: Priority; n: string }>(
      `select priority, count(*) as n from tickets where customer_id = $1 and created_at >= $2 and created_at < $3 and merged_into_ticket_id is null group by priority`,
      base,
    );
    const daily = await tx.query<{ day: string; created: string; resolved: string }>(
      `with days as (
         select generate_series(date_trunc('day', $2::timestamptz at time zone $4), date_trunc('day', ($3::timestamptz - interval '1 second') at time zone $4), interval '1 day') as day)
       select to_char(d.day, 'YYYY-MM-DD') as day,
              (select count(*) from tickets t where t.customer_id = $1 and t.merged_into_ticket_id is null
                  and date_trunc('day', t.created_at at time zone $4) = d.day) as created,
              (select count(*) from tickets t where t.customer_id = $1
                  and date_trunc('day', t.resolved_at at time zone $4) = d.day) as resolved
         from days d order by d.day`,
      [...base, REPORT_TZ],
    );
    let sla: Report["sla"] = null;
    if (staffView) {
      const s = (
        await tx.query<Record<string, string>>(
          `select count(*) as tickets,
                  count(*) filter (where first_response_at is not null and first_response_at <= first_response_due_at) as fr_met,
                  count(*) filter (where (first_response_at is not null and first_response_at > first_response_due_at)
                                      or (first_response_at is null and first_response_due_at < now())) as fr_missed,
                  count(*) filter (where resolved_at is not null and resolution_breached_at is null and resolved_at <= resolution_due_at) as res_met,
                  count(*) filter (where resolution_breached_at is not null or (resolved_at is not null and resolved_at > resolution_due_at)) as res_missed
             from tickets where customer_id = $1 and created_at >= $2 and created_at < $3 and sla_policy_id is not null and merged_into_ticket_id is null`,
          base,
        )
      ).rows[0];
      sla = {
        tickets: num(s.tickets),
        firstResponseMet: num(s.fr_met),
        firstResponseMissed: num(s.fr_missed),
        resolutionMet: num(s.res_met),
        resolutionMissed: num(s.res_missed),
      };
    }
    const csat = (
      await tx.query<{ good: string; bad: string }>(
        `select count(*) filter (where s.rating = 'good') as good, count(*) filter (where s.rating = 'bad') as bad
           from ticket_surveys s join tickets t on t.id = s.ticket_id
          where s.customer_id = $1 and t.resolved_at >= $2 and t.resolved_at < $3`,
        base,
      )
    ).rows[0];
    const comments = staffView
      ? (
          await tx.query<{ number: string; rating: "good" | "bad"; comment: string }>(
            `select t.number, s.rating, s.comment from ticket_surveys s join tickets t on t.id = s.ticket_id
              where s.customer_id = $1 and t.resolved_at >= $2 and t.resolved_at < $3 and s.comment is not null
              order by s.updated_at desc limit 10`,
            base,
          )
        ).rows.map((c) => ({ number: Number(c.number), rating: c.rating, comment: c.comment }))
      : [];
    const top = await tx.query<{ display_name: string; n: string }>(
      `select u.display_name, count(*) as n from tickets t join users u on u.id = t.requester_user_id
        where t.customer_id = $1 and t.created_at >= $2 and t.created_at < $3 and t.merged_into_ticket_id is null
        group by u.display_name order by count(*) desc, u.display_name limit 5`,
      base,
    );
    return {
      customerId,
      customerName: name,
      month,
      timeZone: REPORT_TZ,
      staffView,
      created: num(totals.created),
      resolved: num(totals.resolved),
      openNow: num(totals.open_now),
      requests: num(totals.requests),
      incidents: num(totals.incidents),
      byCategory: cat.rows.map((r) => ({ category: r.category, count: num(r.n) })),
      byPriority: PRIORITIES.map((pr) => ({ priority: pr, count: num(pri.rows.find((r) => r.priority === pr)?.n) })),
      daily: daily.rows.map((d) => ({ day: d.day, created: num(d.created), resolved: num(d.resolved) })),
      medianFirstResponseMinutes: totals.med_fr === null ? null : Math.round(Number(totals.med_fr)),
      medianResolutionHours: totals.med_res === null ? null : Math.round(Number(totals.med_res) * 10) / 10,
      sla,
      satisfaction: { good: num(csat.good), bad: num(csat.bad) },
      comments,
      topRequesters: top.rows.map((t) => ({ name: t.display_name, count: num(t.n) })),
    };
  });
}

/** Neutralises spreadsheet formulas in exported text (CSV injection). */
export function csvCell(v: unknown) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Ticket-level export for technicians: one row per request created in the month. */
export async function exportTicketsCsv(p: Principal, raw: unknown) {
  const { customerId, month } = reportSchema.parse(raw);
  if (!isStaffFor(p, customerId)) throw forbidden("Only technicians can export ticket lists.");
  const { start, end } = monthRange(month);
  const rows = await withUser(p.userId, async (tx) =>
    (
      await tx.query<Record<string, unknown>>(
        `select t.number, t.created_at, t.title, t.kind, t.category, t.priority, t.status, ru.display_name as requester, au.display_name as assignee,
                t.first_response_at, t.resolved_at, t.first_response_due_at, t.resolution_due_at, t.resolution_breached_at, s.rating
           from tickets t join users ru on ru.id = t.requester_user_id left join users au on au.id = t.assignee_user_id
           left join ticket_surveys s on s.ticket_id = t.id
          where t.customer_id = $1 and t.created_at >= $2 and t.created_at < $3 order by t.number`,
        [customerId, start, end],
      )
    ).rows,
  );
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : "");
  const header = ["Number", "Created", "Title", "Type", "Category", "Priority", "Status", "Requester", "Assignee", "First response", "Resolved", "First response met", "Resolution met", "Rating"];
  const lines = rows.map((r) =>
    [
      r.number,
      iso(r.created_at),
      r.title,
      r.kind,
      r.category,
      r.priority,
      r.status,
      r.requester,
      r.assignee,
      iso(r.first_response_at),
      iso(r.resolved_at),
      r.first_response_due_at ? (r.first_response_at && new Date(r.first_response_at as string) <= new Date(r.first_response_due_at as string) ? "yes" : "no") : "",
      r.resolution_due_at ? (r.resolution_breached_at ? "no" : r.resolved_at ? (new Date(r.resolved_at as string) <= new Date(r.resolution_due_at as string) ? "yes" : "no") : "") : "",
      r.rating ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n");
}

export { CATEGORIES };
