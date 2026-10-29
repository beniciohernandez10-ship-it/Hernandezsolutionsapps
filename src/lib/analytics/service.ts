import { z } from "zod";
import { withUser } from "../db";
import { customersWhere, STAFF_ROLES, type Principal } from "../authz";
import { forbidden } from "../errors";
import type { Priority } from "../tickets/schemas";
import { REPORT_TZ } from "../reports/service";

/**
 * Service-desk analytics across the clients a technician supports: volume
 * trend, SLA trend, backlog age, technician workload and first-contact
 * resolution. Read through RLS as the viewer. Periods are rolling windows
 * ending today (Pacific); trends are weekly up to 90 days, monthly beyond.
 */

export const PERIODS = [30, 90, 180, 365] as const;
export type Period = (typeof PERIODS)[number];

export const analyticsQuery = z.object({
  customerId: z.uuid().nullable().default(null),
  days: z.coerce
    .number()
    .refine((d): d is Period => (PERIODS as readonly number[]).includes(d))
    .default(90),
});

export interface Analytics {
  days: Period;
  unit: "week" | "month";
  customers: { id: string; name: string }[];
  customerId: string | null;
  totals: {
    created: number;
    resolved: number;
    openNow: number;
    medianFirstResponseMinutes: number | null;
    medianResolutionHours: number | null;
    satisfactionGood: number;
    satisfactionBad: number;
  };
  trend: {
    bucket: string;
    created: number;
    resolved: number;
    /** Resolved in the bucket with a resolution target, and how many met it. */
    resolutionTracked: number;
    resolutionMet: number;
    /** Opened in the bucket with a first-response target that's been decided (answered, or overdue). */
    firstResponseTracked: number;
    firstResponseMet: number;
  }[];
  backlog: { label: string; count: number; byPriority: Record<Priority, number> }[];
  oldest: { id: string; number: number; title: string; ageDays: number; priority: Priority; customerName: string; assignee: string | null }[];
  workload: { userId: string; name: string; open: number; resolved: number; medianResolutionHours: number | null; loggedMinutes: number }[];
  unassignedOpen: number;
  firstContact: { resolved: number; firstContact: number };
}

const n = (v: unknown) => (v == null ? 0 : Number(v));
const OPEN = "t.status not in ('resolved', 'closed') and t.merged_into_ticket_id is null";
const AGE_BUCKETS: { label: string; from: number; to: number | null }[] = [
  { label: "Under 1 day", from: 0, to: 1 },
  { label: "1–3 days", from: 1, to: 3 },
  { label: "3–7 days", from: 3, to: 7 },
  { label: "1–4 weeks", from: 7, to: 28 },
  { label: "Over 4 weeks", from: 28, to: null },
];

export async function analytics(p: Principal, raw: unknown = {}): Promise<Analytics> {
  const q = analyticsQuery.parse(raw);
  const mine = p.memberships.filter((m) => STAFF_ROLES.includes(m.role)).map((m) => ({ id: m.customerId, name: m.customerName }));
  if (!mine.length) throw forbidden("Only technicians can see analytics.");
  if (q.customerId && !customersWhere(p, (r) => STAFF_ROLES.includes(r)).includes(q.customerId)) throw forbidden("You don't support this client.");
  const ids = q.customerId ? [q.customerId] : mine.map((c) => c.id);
  const days = q.days as Period;
  const unit = days <= 90 ? "week" : "month";

  return withUser(p.userId, async (tx) => {
    const since = (await tx.query<{ s: string }>("select (now() - make_interval(days => $1))::text as s", [days])).rows[0].s;
    const base = [ids, since];

    const totals = (
      await tx.query<Record<string, string | null>>(
        `select
           count(*) filter (where t.created_at >= $2) as created,
           count(*) filter (where t.resolved_at >= $2) as resolved,
           count(*) filter (where ${OPEN}) as open_now,
           (percentile_cont(0.5) within group (order by extract(epoch from (t.first_response_at - t.created_at)) / 60)
              filter (where t.created_at >= $2 and t.first_response_at is not null)) as med_fr,
           (percentile_cont(0.5) within group (order by extract(epoch from (t.resolved_at - t.created_at)) / 3600)
              filter (where t.resolved_at >= $2)) as med_res
         from tickets t where t.customer_id = any($1) and t.merged_into_ticket_id is null`,
        base,
      )
    ).rows[0];
    const csat = (
      await tx.query<{ good: string; bad: string }>(
        `select count(*) filter (where s.rating = 'good') as good, count(*) filter (where s.rating = 'bad') as bad
           from ticket_surveys s join tickets t on t.id = s.ticket_id where t.customer_id = any($1) and t.resolved_at >= $2`,
        base,
      )
    ).rows[0];

    const trend = await tx.query<Record<string, string>>(
      `with b as (
         select generate_series(date_trunc($3, $2::timestamptz at time zone $4), date_trunc($3, now() at time zone $4), ('1 ' || $3)::interval) as s)
       select to_char(b.s, 'YYYY-MM-DD') as bucket,
         (select count(*) from tickets t where t.customer_id = any($1) and t.merged_into_ticket_id is null
             and date_trunc($3, t.created_at at time zone $4) = b.s) as created,
         (select count(*) from tickets t where t.customer_id = any($1) and t.merged_into_ticket_id is null
             and date_trunc($3, t.resolved_at at time zone $4) = b.s) as resolved,
         (select count(*) from tickets t where t.customer_id = any($1) and t.merged_into_ticket_id is null and t.resolution_due_at is not null
             and date_trunc($3, t.resolved_at at time zone $4) = b.s) as res_tracked,
         (select count(*) from tickets t where t.customer_id = any($1) and t.merged_into_ticket_id is null and t.resolution_due_at is not null
             and date_trunc($3, t.resolved_at at time zone $4) = b.s and t.resolution_breached_at is null and t.resolved_at <= t.resolution_due_at) as res_met,
         (select count(*) from tickets t where t.customer_id = any($1) and t.merged_into_ticket_id is null and t.first_response_due_at is not null
             and date_trunc($3, t.created_at at time zone $4) = b.s and (t.first_response_at is not null or t.first_response_due_at < now())) as fr_tracked,
         (select count(*) from tickets t where t.customer_id = any($1) and t.merged_into_ticket_id is null and t.first_response_due_at is not null
             and date_trunc($3, t.created_at at time zone $4) = b.s and t.first_response_at is not null and t.first_response_at <= t.first_response_due_at) as fr_met
       from b order by b.s`,
      [ids, since, unit, REPORT_TZ],
    );

    const open = await tx.query<{ age_days: string; priority: Priority }>(
      `select extract(epoch from (now() - t.created_at)) / 86400 as age_days, t.priority from tickets t where t.customer_id = any($1) and ${OPEN}`,
      [ids],
    );
    const backlog = AGE_BUCKETS.map((b) => {
      const rows = open.rows.filter((r) => Number(r.age_days) >= b.from && (b.to === null || Number(r.age_days) < b.to));
      const byPriority = { low: 0, normal: 0, high: 0, urgent: 0 } as Record<Priority, number>;
      for (const r of rows) byPriority[r.priority]++;
      return { label: b.label, count: rows.length, byPriority };
    });
    const oldest = await tx.query<Record<string, unknown>>(
      `select t.id, t.number, t.title, t.priority, extract(epoch from (now() - t.created_at)) / 86400 as age_days, c.name as customer_name, a.display_name as assignee
         from tickets t join customers c on c.id = t.customer_id left join users a on a.id = t.assignee_user_id
        where t.customer_id = any($1) and ${OPEN} order by t.created_at limit 5`,
      [ids],
    );

    const workload = await tx.query<Record<string, string | null>>(
      `with staff as (
         select distinct m.user_id from memberships m where m.customer_id = any($1) and m.revoked_at is null and m.role in ('technician', 'service_manager'))
       select u.id, u.display_name,
              (select count(*) from tickets t where t.assignee_user_id = u.id and t.customer_id = any($1) and ${OPEN}) as open,
              (select count(*) from tickets t where t.assignee_user_id = u.id and t.customer_id = any($1) and t.merged_into_ticket_id is null and t.resolved_at >= $2) as resolved,
              (select percentile_cont(0.5) within group (order by extract(epoch from (t.resolved_at - t.created_at)) / 3600)
                 from tickets t where t.assignee_user_id = u.id and t.customer_id = any($1) and t.merged_into_ticket_id is null and t.resolved_at >= $2) as med_res,
              (select coalesce(sum(e.minutes), 0) from time_entries e where e.user_id = u.id and e.customer_id = any($1) and e.work_date >= ($2::timestamptz at time zone $3)::date) as logged
         from staff s join users u on u.id = s.user_id
        order by u.display_name`,
      [...base, REPORT_TZ],
    );
    const unassigned = (
      await tx.query<{ n: string }>(`select count(*) as n from tickets t where t.customer_id = any($1) and t.assignee_user_id is null and ${OPEN}`, [ids])
    ).rows[0];

    // First contact: resolved without being reopened, with at most one public reply from staff before it was resolved.
    const fcr = (
      await tx.query<{ resolved: string; fcr: string }>(
        `select count(*) as resolved,
                count(*) filter (where not exists (select 1 from ticket_events e where e.ticket_id = t.id and e.kind = 'reopened')
                  and (select count(*) from ticket_messages m where m.ticket_id = t.id and m.visibility = 'public' and m.created_at <= t.resolved_at
                         and app_author_is_staff(m.author_user_id, m.customer_id)) <= 1) as fcr
           from tickets t where t.customer_id = any($1) and t.merged_into_ticket_id is null and t.resolved_at >= $2`,
        base,
      )
    ).rows[0];

    return {
      days,
      unit,
      customers: mine,
      customerId: q.customerId,
      totals: {
        created: n(totals.created),
        resolved: n(totals.resolved),
        openNow: n(totals.open_now),
        medianFirstResponseMinutes: totals.med_fr === null ? null : Math.round(Number(totals.med_fr)),
        medianResolutionHours: totals.med_res === null ? null : Math.round(Number(totals.med_res) * 10) / 10,
        satisfactionGood: n(csat.good),
        satisfactionBad: n(csat.bad),
      },
      trend: trend.rows.map((r) => ({
        bucket: r.bucket,
        created: n(r.created),
        resolved: n(r.resolved),
        resolutionTracked: n(r.res_tracked),
        resolutionMet: n(r.res_met),
        firstResponseTracked: n(r.fr_tracked),
        firstResponseMet: n(r.fr_met),
      })),
      backlog,
      oldest: oldest.rows.map((r) => ({
        id: String(r.id),
        number: Number(r.number),
        title: String(r.title),
        ageDays: Math.floor(Number(r.age_days)),
        priority: r.priority as Priority,
        customerName: String(r.customer_name),
        assignee: (r.assignee as string) ?? null,
      })),
      workload: workload.rows
        .map((r) => ({
          userId: String(r.id),
          name: String(r.display_name),
          open: n(r.open),
          resolved: n(r.resolved),
          medianResolutionHours: r.med_res === null ? null : Math.round(Number(r.med_res) * 10) / 10,
          loggedMinutes: n(r.logged),
        }))
        .sort((a, b) => b.open - a.open || b.resolved - a.resolved || a.name.localeCompare(b.name)),
      unassignedOpen: n(unassigned.n),
      firstContact: { resolved: n(fcr.resolved), firstContact: n(fcr.fcr) },
    };
  });
}
