import { z } from "zod";
import { asSystem, type Queryable } from "../db";
import { customersWhere, isStaffAnywhere, roleFor, STAFF_ROLES, type Principal } from "../authz";
import { AppError, forbidden, notFound } from "../errors";
import { enqueue } from "../jobs-queue";
import { errorSummary, log } from "../log";
import { todayPacific } from "../billing/service";
import { CATEGORIES, PRIORITIES, type Category, type Priority, type Status } from "../tickets/schemas";
import { createSystemTicket, SYSTEM_USERS } from "../tickets/system";
import { describeSchedule, fillPlaceholders, FREQUENCIES, occurrence, nextIndexAfter, type Frequency } from "./schedule";

/**
 * Recurring tickets: a template per client that opens a request on each date
 * of its schedule (from the IT Center Scheduler account, or a named member of
 * the client), with SLA, assignment rules and notifications as usual.
 * Technicians see the schedules for their clients; platform operators and the
 * client's service managers change them.
 */

export const SCHEDULER_USER = SYSTEM_USERS.scheduler;

export interface RecurringRow {
  id: string;
  customerId: string;
  customerName: string;
  title: string;
  description: string;
  priority: Priority;
  category: Category;
  requesterUserId: string | null;
  requesterName: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  queueId: string | null;
  queueName: string | null;
  tasks: string[];
  frequency: Frequency;
  interval: number;
  startsOn: string;
  endsOn: string | null;
  schedule: string;
  nextRunOn: string | null;
  lastRunOn: string | null;
  lastOutcome: "created" | "skipped_open" | null;
  lastTicket: { id: string; number: number; status: Status } | null;
  skipIfOpen: boolean;
  active: boolean;
  canManage: boolean;
}

const canManage = (p: Principal, customerId: string) => p.isOperator || roleFor(p, customerId) === "service_manager";

function requireManage(p: Principal, customerId: string) {
  if (!canManage(p, customerId)) throw forbidden("Only platform operators and the client's service managers can change recurring requests.");
}

async function audit(tx: Queryable, actor: string | null, customerId: string, action: string, id: string, details: object) {
  await tx.query(
    "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, $3, 'recurring_ticket', $4, $5)",
    [actor, customerId, action, id, JSON.stringify(details)],
  );
}

const realDate = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Use a date like 2026-11-15." }).refine(realDate, { error: "That date doesn't exist." });

const schema = z.object({
  customerId: z.uuid({ error: "Choose a client." }),
  title: z
    .string()
    .transform((s) => s.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(3, { error: "Give it a title (at least 3 characters)." }).max(200, { error: "Keep the title under 200 characters." })),
  description: z.string().max(20000).default(""),
  priority: z.enum(PRIORITIES).default("normal"),
  category: z.enum(CATEGORIES).default("general"),
  requesterUserId: z.uuid().nullable().default(null),
  assigneeUserId: z.uuid().nullable().default(null),
  queueId: z.uuid().nullable().default(null),
  tasks: z
    .array(z.string().transform((s) => s.trim()))
    .max(30, { error: "Keep the checklist to 30 items." })
    .default([])
    .transform((t) => t.filter(Boolean).map((s) => s.slice(0, 200))),
  frequency: z.enum(FREQUENCIES, { error: "Choose how often." }),
  interval: z.number().int().min(1).max(12).default(1),
  startsOn: date,
  endsOn: date.nullable().default(null),
  skipIfOpen: z.boolean().default(true),
  active: z.boolean().default(true),
});

/** First occurrence index at or after `from` that falls on or after `day`. */
function indexOnOrAfter(startsOn: string, f: Frequency, interval: number, from: number, day: string) {
  let n = from;
  for (let guard = 0; occurrence(startsOn, f, interval, n) < day && guard < 100_000; guard++) n++;
  return n;
}

function nextFrom(row: { startsOn: string; frequency: Frequency; interval: number; endsOn: string | null }, runs: number) {
  const next = occurrence(row.startsOn, row.frequency, row.interval, runs);
  return row.endsOn && next > row.endsOn ? null : next;
}

const SELECT = `
  select r.*, r.starts_on::text as starts_text, r.ends_on::text as ends_text, r.next_run_on::text as next_text, r.last_run_on::text as last_text,
         c.name as customer_name, rq.display_name as requester_name, a.display_name as assignee_name, q.name as queue_name,
         t.number as last_number, t.status as last_status
    from recurring_tickets r
    join customers c on c.id = r.customer_id
    left join users rq on rq.id = r.requester_user_id
    left join users a on a.id = r.assignee_user_id
    left join queues q on q.id = r.queue_id
    left join tickets t on t.id = r.last_ticket_id`;

type DbRow = Record<string, unknown> & { id: string; customer_id: string };

function toRow(p: Principal | null, r: DbRow): RecurringRow {
  const str = (v: unknown) => (v == null ? null : String(v));
  const frequency = r.frequency as Frequency;
  const interval = Number(r.interval_count);
  const startsOn = String(r.starts_text);
  return {
    id: r.id,
    customerId: r.customer_id,
    customerName: String(r.customer_name),
    title: String(r.title),
    description: String(r.description),
    priority: r.priority as Priority,
    category: r.category as Category,
    requesterUserId: str(r.requester_user_id),
    requesterName: str(r.requester_name),
    assigneeUserId: str(r.assignee_user_id),
    assigneeName: str(r.assignee_name),
    queueId: str(r.queue_id),
    queueName: str(r.queue_name),
    tasks: (r.tasks as string[]) ?? [],
    frequency,
    interval,
    startsOn,
    endsOn: str(r.ends_text),
    schedule: describeSchedule(startsOn, frequency, interval),
    nextRunOn: r.active ? str(r.next_text) : null,
    lastRunOn: str(r.last_text),
    lastOutcome: (r.last_outcome as RecurringRow["lastOutcome"]) ?? null,
    lastTicket: r.last_ticket_id ? { id: String(r.last_ticket_id), number: Number(r.last_number), status: r.last_status as Status } : null,
    skipIfOpen: Boolean(r.skip_if_open),
    active: Boolean(r.active),
    canManage: p ? canManage(p, r.customer_id) : false,
  };
}

/** Schedules for the clients this person supports (all clients for operators). */
export async function listRecurring(p: Principal): Promise<RecurringRow[]> {
  if (!p.isOperator && !isStaffAnywhere(p)) throw forbidden("Only technicians can see recurring requests.");
  const customers = p.isOperator ? null : customersWhere(p, (r) => STAFF_ROLES.includes(r));
  return asSystem(async (tx) => {
    const r = await tx.query<DbRow>(`${SELECT} where ($1::uuid[] is null or r.customer_id = any($1)) order by c.name, r.active desc, r.next_run_on nulls last, r.title`, [customers]);
    return r.rows.map((x) => toRow(p, x));
  });
}

export interface RecurringOptions {
  customers: { id: string; name: string; members: { id: string; name: string; staff: boolean }[] }[];
  queues: { id: string; name: string }[];
}

/** Choices for the editor: the clients this person can manage, their members, and the queues. */
export async function recurringOptions(p: Principal): Promise<RecurringOptions> {
  return asSystem(async (tx) => {
    const c = await tx.query<{ id: string; name: string }>("select id, name from customers where status = 'active' order by name");
    const customers = c.rows.filter((x) => canManage(p, x.id));
    const ids = customers.map((x) => x.id);
    const m = await tx.query<{ customer_id: string; id: string; name: string; role: string }>(
      `select m.customer_id, u.id, u.display_name as name, m.role
         from memberships m join users u on u.id = m.user_id
        where m.customer_id = any($1) and m.revoked_at is null and u.status = 'active'
        order by u.display_name`,
      [ids],
    );
    const q = await tx.query<{ id: string; name: string }>("select id, name from queues order by name");
    return {
      customers: customers.map((x) => ({
        ...x,
        members: m.rows.filter((r) => r.customer_id === x.id).map((r) => ({ id: r.id, name: r.name, staff: STAFF_ROLES.includes(r.role as never) })),
      })),
      queues: q.rows,
    };
  });
}

async function checkPeople(tx: Queryable, v: z.infer<typeof schema>) {
  const member = async (userId: string, staff: boolean) =>
    (
      await tx.query(
        `select 1 from memberships m join users u on u.id = m.user_id
          where m.user_id = $1 and m.customer_id = $2 and m.revoked_at is null and u.status = 'active'
            and ($3::boolean is false or m.role in ('technician', 'service_manager'))`,
        [userId, v.customerId, staff],
      )
    ).rows.length > 0;
  if (v.requesterUserId && !(await member(v.requesterUserId, false))) {
    throw new AppError(422, "validation_failed", "The requester must be a member of this client.", { field: "requesterUserId" });
  }
  if (v.assigneeUserId && !(await member(v.assigneeUserId, true))) {
    throw new AppError(422, "validation_failed", "Assign it to a technician who supports this client.", { field: "assigneeUserId" });
  }
  if (v.queueId && !(await tx.query("select 1 from queues where id = $1", [v.queueId])).rows[0]) {
    throw new AppError(422, "validation_failed", "That queue no longer exists.", { field: "queueId" });
  }
  if (v.endsOn && v.endsOn < v.startsOn) throw new AppError(422, "validation_failed", "The end date is before the start date.", { field: "endsOn" });
}

export async function saveRecurring(p: Principal, id: string | null, raw: unknown, now = new Date()) {
  const v = schema.parse(raw);
  requireManage(p, v.customerId);
  const today = todayPacific(now);
  return asSystem(async (tx) => {
    await checkPeople(tx, v);
    let runs = indexOnOrAfter(v.startsOn, v.frequency, v.interval, 0, today);
    if (id) {
      const cur = await tx.query<{ customer_id: string; starts_on: string; frequency: Frequency; interval_count: number; runs: number }>(
        "select customer_id, starts_on::text as starts_on, frequency, interval_count, runs from recurring_tickets where id = $1 for update",
        [id],
      );
      const c = cur.rows[0];
      if (!c) throw notFound("Recurring request");
      requireManage(p, c.customer_id);
      if (c.customer_id !== v.customerId) throw new AppError(422, "validation_failed", "A recurring request can't move to another client.", { field: "customerId" });
      const startsOn = c.starts_on;
      // Same schedule: keep counting from where it got to (skipping dates missed while paused).
      if (startsOn === v.startsOn && c.frequency === v.frequency && Number(c.interval_count) === v.interval) {
        runs = indexOnOrAfter(v.startsOn, v.frequency, v.interval, c.runs, today);
      }
    }
    const next = nextFrom(v, runs);
    const values = [
      v.customerId, v.title, v.description, v.priority, v.category, v.requesterUserId, v.assigneeUserId, v.queueId, JSON.stringify(v.tasks),
      v.frequency, v.interval, v.startsOn, v.endsOn, runs, next, v.skipIfOpen, v.active,
    ];
    const r = id
      ? await tx.query<{ id: string }>(
          `update recurring_tickets set title = $2, description = $3, priority = $4, category = $5, requester_user_id = $6, assignee_user_id = $7,
                  queue_id = $8, tasks = $9, frequency = $10, interval_count = $11, starts_on = $12, ends_on = $13, runs = $14, next_run_on = $15,
                  skip_if_open = $16, active = $17, updated_at = now()
            where id = $18 and customer_id = $1 returning id`,
          [...values, id],
        )
      : await tx.query<{ id: string }>(
          `insert into recurring_tickets (customer_id, title, description, priority, category, requester_user_id, assignee_user_id, queue_id, tasks,
                                          frequency, interval_count, starts_on, ends_on, runs, next_run_on, skip_if_open, active, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) returning id`,
          [...values, p.userId],
        );
    const savedId = r.rows[0].id;
    await audit(tx, p.userId, v.customerId, id ? "recurring.update" : "recurring.create", savedId, {
      title: v.title, schedule: describeSchedule(v.startsOn, v.frequency, v.interval), nextRunOn: next, active: v.active,
    });
    return { id: savedId, nextRunOn: next };
  });
}

export async function deleteRecurring(p: Principal, id: string) {
  return asSystem(async (tx) => {
    const r = await tx.query<{ customer_id: string; title: string }>("select customer_id, title from recurring_tickets where id = $1 for update", [id]);
    if (!r.rows[0]) throw notFound("Recurring request");
    requireManage(p, r.rows[0].customer_id);
    await tx.query("delete from recurring_tickets where id = $1", [id]);
    await audit(tx, p.userId, r.rows[0].customer_id, "recurring.delete", id, { title: r.rows[0].title });
    return { ok: true };
  });
}

/** Opens the request for one occurrence. Doesn't move the schedule. */
async function openFor(tx: Queryable, r: DbRow, day: string) {
  const row = toRow(null, r);
  // A named requester who has since left the client falls back to the Scheduler account.
  const stillMember = row.requesterUserId
    ? (
        await tx.query(
          "select 1 from memberships m join users u on u.id = m.user_id where m.user_id = $1 and m.customer_id = $2 and m.revoked_at is null and u.status = 'active'",
          [row.requesterUserId, row.customerId],
        )
      ).rows.length > 0
    : false;
  const body = fillPlaceholders(row.description, day).trim();
  const note = `Opened automatically by a recurring request: ${row.schedule}.`;
  return createSystemTicket(tx, {
    customerId: row.customerId,
    requesterId: stillMember ? row.requesterUserId! : SCHEDULER_USER,
    source: "scheduled",
    kind: "request",
    title: fillPlaceholders(row.title, day),
    description: body ? `${body}\n\n${note}` : note,
    priority: row.priority,
    category: row.category,
    assigneeUserId: row.assigneeUserId,
    queueId: row.queueId,
    tasks: row.tasks.map((t) => fillPlaceholders(t, day)),
  });
}

/** Opens a request now, outside the schedule (to try a template, or when it's needed early). */
export async function runRecurringNow(p: Principal, id: string, now = new Date()) {
  return asSystem(async (tx) => {
    const r = await tx.query<DbRow>(`${SELECT} where r.id = $1 for update of r`, [id]);
    if (!r.rows[0]) throw notFound("Recurring request");
    requireManage(p, r.rows[0].customer_id);
    const t = await openFor(tx, r.rows[0], todayPacific(now));
    await tx.query("update recurring_tickets set last_ticket_id = $2, last_run_on = $3, last_outcome = 'created', updated_at = now() where id = $1", [id, t.id, todayPacific(now)]);
    await audit(tx, p.userId, r.rows[0].customer_id, "recurring.run_now", id, { ticketId: t.id, number: t.number });
    return t;
  });
}

/**
 * Opens requests for every schedule that's due (today, Pacific time, or
 * missed). One request per schedule per run even if several dates were
 * missed; the schedule then moves to its next date after today. With "skip
 * if still open", a date is skipped while the previous request is unresolved.
 */
export async function runDueRecurring(now = new Date()) {
  const today = todayPacific(now);
  const due = await asSystem((tx) =>
    tx.query<{ id: string }>("select id from recurring_tickets where active and next_run_on is not null and next_run_on <= $1 order by next_run_on limit 200", [today]),
  );
  let created = 0;
  let skipped = 0;
  for (const { id } of due.rows) {
    try {
      await asSystem(async (tx) => {
        // Claimed with SKIP LOCKED and re-checked, so overlapping runs never open two requests.
        const r = await tx.query<DbRow>(`${SELECT} where r.id = $1 and r.active and r.next_run_on <= $2 for update of r skip locked`, [id, today]);
        const row = r.rows[0];
        if (!row) return;
        const open = row.skip_if_open && row.last_ticket_id && !["resolved", "closed"].includes(String(row.last_status));
        const day = toRow(null, row).nextRunOn!;
        let ticket: { id: string; number: number } | null = null;
        if (!open) ticket = await openFor(tx, row, day);
        const f = row.frequency as Frequency;
        const interval = Number(row.interval_count);
        const startsOn = toRow(null, row).startsOn;
        const runs = nextIndexAfter(startsOn, f, interval, Number(row.runs), today);
        const next = nextFrom({ startsOn, frequency: f, interval, endsOn: toRow(null, row).endsOn }, runs);
        await tx.query(
          `update recurring_tickets set runs = $2, next_run_on = $3, last_run_on = $4, last_outcome = $5,
                  last_ticket_id = coalesce($6, last_ticket_id), updated_at = now() where id = $1`,
          [id, runs, next, today, open ? "skipped_open" : "created", ticket?.id ?? null],
        );
        await audit(tx, null, row.customer_id, open ? "recurring.skipped" : "recurring.ticket", id, {
          occurrence: day, ticketId: ticket?.id ?? row.last_ticket_id, number: ticket?.number ?? Number(row.last_number), nextRunOn: next,
        });
        if (open) skipped++;
        else created++;
      });
    } catch (err) {
      log.error("recurring.run_failed", { recurringId: id, error: errorSummary(err) });
    }
  }
  return { created, skipped };
}

/** At most once an hour (deduplicated); called from the request sweep and the daily cron. */
export async function scheduleRecurring(now = new Date()) {
  await asSystem((tx) => enqueue(tx, "recurring.run", null, {}, `recurring:${now.toISOString().slice(0, 13)}`));
}
