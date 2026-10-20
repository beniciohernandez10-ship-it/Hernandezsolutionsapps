import { z } from "zod";
import type { Queryable } from "../db";
import { asSystem } from "../db";
import { PRIORITIES, type Priority, type Status } from "../tickets/schemas";
import { addBusinessMinutes, businessMinutesBetween, hasBusinessHours, isValidTimeZone, type BusinessCalendar } from "./calendar";

/**
 * Service levels. A customer may have one policy; a ticket snapshots the
 * policy id when created. Due times are business-time targets from the
 * policy's calendar. The resolution clock pauses while a ticket waits on the
 * customer or is resolved, and resumes on reply or reopen. First response is
 * never paused.
 */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, { error: "Use HH:MM (24-hour)." });
const target = z.object({
  firstResponse: z.number().int().min(1).max(100_000),
  resolution: z.number().int().min(1).max(500_000),
});

export const slaPolicySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    timeZone: z.string().refine(isValidTimeZone, { error: "Unknown time zone." }),
    hours: z.record(z.enum(["0", "1", "2", "3", "4", "5", "6"]), z.array(z.tuple([hhmm, hhmm])).max(4)),
    holidays: z.array(z.iso.date()).max(366),
    targets: z.object(Object.fromEntries(PRIORITIES.map((p) => [p, target])) as Record<Priority, typeof target>),
    warnPercent: z.number().int().min(1).max(99),
  })
  .refine((p) => Object.values(p.hours).every((spans) => spans.every(([s, e]) => e > s)), { error: "Each window must end after it starts.", path: ["hours"] })
  .refine((p) => hasBusinessHours({ timeZone: p.timeZone, hours: p.hours, holidays: [] }), { error: "Add at least one business-hours window.", path: ["hours"] })
  .refine((p) => PRIORITIES.every((k) => p.targets[k].resolution >= p.targets[k].firstResponse), {
    error: "Resolution targets must be at least the first-response target.",
    path: ["targets"],
  });
export type SlaPolicyInput = z.infer<typeof slaPolicySchema>;

export interface SlaPolicy extends SlaPolicyInput {
  id: string;
}

export function policyFromRow(r: Record<string, unknown>): SlaPolicy {
  const holidays = ((r.holidays as unknown[]) ?? []).map((d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)));
  return {
    id: r.id as string,
    name: r.name as string,
    timeZone: r.time_zone as string,
    hours: r.business_hours as SlaPolicy["hours"],
    holidays,
    targets: r.targets as SlaPolicy["targets"],
    warnPercent: Number(r.warn_percent),
  };
}

export const calendarOf = (p: SlaPolicy): BusinessCalendar => ({ timeZone: p.timeZone, hours: p.hours, holidays: p.holidays });

async function loadPolicy(tx: Queryable, id: string | null): Promise<SlaPolicy | null> {
  if (!id) return null;
  const r = await tx.query("select * from sla_policies where id = $1", [id]);
  return r.rows[0] ? policyFromRow(r.rows[0]) : null;
}

interface DueTimes {
  firstResponseDue: Date;
  firstResponseWarn: Date;
  resolutionDue: Date;
  resolutionWarn: Date;
}

/** Due and warning instants for a ticket created at `createdAt`, extended by paused business minutes. */
export function dueTimes(policy: SlaPolicy, priority: Priority, createdAt: Date, pausedMinutes = 0): DueTimes {
  const cal = calendarOf(policy);
  const t = policy.targets[priority];
  const warn = (mins: number) => Math.max(1, Math.floor((mins * policy.warnPercent) / 100));
  return {
    firstResponseDue: addBusinessMinutes(createdAt, t.firstResponse, cal),
    firstResponseWarn: addBusinessMinutes(createdAt, warn(t.firstResponse), cal),
    resolutionDue: addBusinessMinutes(createdAt, t.resolution + pausedMinutes, cal),
    resolutionWarn: addBusinessMinutes(createdAt, warn(t.resolution) + pausedMinutes, cal),
  };
}

const PAUSED: Status[] = ["waiting", "resolved"];

/** Sets SLA fields on a newly created ticket from its customer's policy (if any). */
export async function applySlaOnCreate(tx: Queryable, ticketId: string) {
  const r = await tx.query<{ priority: Priority; created_at: string; sla_policy_id: string | null }>(
    `select t.priority, t.created_at, c.sla_policy_id from tickets t join customers c on c.id = t.customer_id where t.id = $1`,
    [ticketId],
  );
  const row = r.rows[0];
  const policy = await loadPolicy(tx, row?.sla_policy_id ?? null);
  if (!row || !policy) return;
  const d = dueTimes(policy, row.priority, new Date(row.created_at));
  await tx.query(
    `update tickets set sla_policy_id = $2, first_response_due_at = $3, first_response_warn_at = $4,
            resolution_due_at = $5, resolution_warn_at = $6 where id = $1`,
    [ticketId, policy.id, d.firstResponseDue, d.firstResponseWarn, d.resolutionDue, d.resolutionWarn],
  );
}

/**
 * Keeps the clock right after a status or priority change. Called in the same
 * transaction as the change, after the ticket row has been updated.
 */
export async function applySlaTransition(
  tx: Queryable,
  ticketId: string,
  change: { fromStatus: Status; toStatus: Status; priorityChanged?: boolean },
  now = new Date(),
) {
  const r = await tx.query<{
    priority: Priority;
    created_at: string;
    sla_policy_id: string | null;
    sla_paused_since: string | null;
    sla_paused_minutes: number;
  }>("select priority, created_at, sla_policy_id, sla_paused_since, sla_paused_minutes from tickets where id = $1", [ticketId]);
  const row = r.rows[0];
  const policy = await loadPolicy(tx, row?.sla_policy_id ?? null);
  if (!row || !policy) return;

  let paused = Number(row.sla_paused_minutes);
  let pausedSince = row.sla_paused_since ? new Date(row.sla_paused_since) : null;
  const wasPaused = PAUSED.includes(change.fromStatus);
  const isPaused = PAUSED.includes(change.toStatus);
  if (!wasPaused && isPaused) pausedSince = now;
  if (wasPaused && !isPaused && pausedSince) {
    paused += businessMinutesBetween(pausedSince, now, calendarOf(policy));
    pausedSince = null;
  }
  if (!change.priorityChanged && wasPaused === isPaused) return;

  const d = dueTimes(policy, row.priority, new Date(row.created_at), paused);
  // A target that moved later clears its warning so a new one can be sent.
  await tx.query(
    `update tickets set sla_paused_since = $2, sla_paused_minutes = $3,
            first_response_due_at = $4, first_response_warn_at = $5, resolution_due_at = $6, resolution_warn_at = $7,
            first_response_warned_at = case when first_response_breached_at is null and $5 > now() then null else first_response_warned_at end,
            resolution_warned_at = case when resolution_breached_at is null and $7 > now() then null else resolution_warned_at end
      where id = $1`,
    [ticketId, pausedSince, paused, d.firstResponseDue, d.firstResponseWarn, d.resolutionDue, d.resolutionWarn],
  );
}

export type SlaState = "met" | "breached" | "at_risk" | "on_track" | "paused" | "none";

export interface TicketSla {
  policyName: string;
  firstResponse: { dueAt: string; state: SlaState; respondedAt: string | null };
  resolution: { dueAt: string; state: SlaState; resolvedAt: string | null; pausedMinutes: number };
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Staff-facing SLA summary for one ticket row (null when no policy applies). */
export function slaSummary(row: Record<string, unknown>, policyName: string | null, now = new Date()): TicketSla | null {
  if (!row.sla_policy_id || !policyName || !row.first_response_due_at || !row.resolution_due_at) return null;
  const t = now.getTime();
  const at = (v: unknown) => new Date(v as string).getTime();
  const fr = (): SlaState => {
    if (row.first_response_at) return at(row.first_response_at) <= at(row.first_response_due_at) ? "met" : "breached";
    if (t > at(row.first_response_due_at)) return "breached";
    return t >= at(row.first_response_warn_at) ? "at_risk" : "on_track";
  };
  const res = (): SlaState => {
    if (row.resolved_at) return row.resolution_breached_at || at(row.resolved_at) > at(row.resolution_due_at) ? "breached" : "met";
    if (row.resolution_breached_at) return "breached";
    if (row.sla_paused_since) return "paused";
    if (t > at(row.resolution_due_at)) return "breached";
    return t >= at(row.resolution_warn_at) ? "at_risk" : "on_track";
  };
  return {
    policyName,
    firstResponse: { dueAt: iso(row.first_response_due_at)!, state: fr(), respondedAt: iso(row.first_response_at) },
    resolution: { dueAt: iso(row.resolution_due_at)!, state: res(), resolvedAt: iso(row.resolved_at), pausedMinutes: Number(row.sla_paused_minutes ?? 0) },
  };
}

/** Compact list badge for staff: the worst open SLA state. */
export function slaBadge(row: Record<string, unknown>, now = new Date()): "breached" | "at_risk" | null {
  if (!row.sla_policy_id || row.status === "resolved") return null;
  const s = slaSummary(row, "x", now);
  if (!s) return null;
  const states = [s.firstResponse.respondedAt ? null : s.firstResponse.state, s.resolution.state];
  if (states.includes("breached")) return "breached";
  if (states.includes("at_risk")) return "at_risk";
  return null;
}

export interface SweepEvent {
  ticketId: string;
  customerId: string;
  kind: "sla_warning" | "sla_breached";
  target: "first_response" | "resolution";
}

/**
 * Marks warnings and breaches that are due, once each, and records them in the
 * ticket history. Returns what changed so the caller can notify people.
 */
export async function sweepSla(now = new Date()): Promise<SweepEvent[]> {
  return asSystem(async (tx) => {
    const events: SweepEvent[] = [];
    const mark = async (sql: string, kind: SweepEvent["kind"], target: SweepEvent["target"]) => {
      const r = await tx.query<{ id: string; customer_id: string }>(sql, [now]);
      for (const t of r.rows) {
        await tx.query(
          "insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, to_value) values ($1, $2, null, $3, $4)",
          [t.id, t.customer_id, kind, target],
        );
        events.push({ ticketId: t.id, customerId: t.customer_id, kind, target });
      }
    };
    const open = "status <> 'resolved' and sla_policy_id is not null";
    await mark(
      `update tickets set first_response_breached_at = $1 where ${open} and first_response_at is null
         and first_response_breached_at is null and first_response_due_at <= $1 returning id, customer_id`,
      "sla_breached",
      "first_response",
    );
    await mark(
      `update tickets set first_response_warned_at = $1 where ${open} and first_response_at is null
         and first_response_breached_at is null and first_response_warned_at is null and first_response_warn_at <= $1 returning id, customer_id`,
      "sla_warning",
      "first_response",
    );
    await mark(
      `update tickets set resolution_breached_at = $1 where ${open} and sla_paused_since is null
         and resolution_breached_at is null and resolution_due_at <= $1 returning id, customer_id`,
      "sla_breached",
      "resolution",
    );
    await mark(
      `update tickets set resolution_warned_at = $1 where ${open} and sla_paused_since is null
         and resolution_breached_at is null and resolution_warned_at is null and resolution_warn_at <= $1 returning id, customer_id`,
      "sla_warning",
      "resolution",
    );
    return events;
  });
}
