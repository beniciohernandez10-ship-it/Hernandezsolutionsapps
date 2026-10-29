import { z } from "zod";
import { asSystem, withUser, type Queryable } from "../db";
import { canSeeOrgFor, customersWhere, isStaffAnywhere, isStaffFor, requireOperator, STAFF_ROLES, type Principal } from "../authz";
import { AppError, forbidden, notFound } from "../errors";
import { csvCell } from "../reports/service";
import { computeMonth, decimalHours, monthRange, parseDuration, roundEntry, type ContractKind, type ContractTerms, type MonthTotals } from "./compute";

/**
 * Time tracking and billing.
 *
 * - Technicians log time on a ticket or as general work for a client. Entries
 *   are theirs to edit until the month is finalized; service managers can
 *   correct anyone's for their clients (RLS, 0020).
 * - Each client has at most one active contract (retainer, block or hourly)
 *   that decides how billable time is charged (compute.ts).
 * - Operators review a month per client, export it for invoicing, and
 *   finalize it, which locks the entries. Reopening unlocks them (audited).
 * - Client administrators see hours used against their plan, never notes.
 */

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const dateOnly = (v: unknown) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);
const UUID = /^[0-9a-f-]{36}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function currentMonthPacific(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit" }).format(now).slice(0, 7);
}
export function todayPacific(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

async function audit(tx: Queryable, p: Principal, customerId: string | null, action: string, targetType: string, targetId: string, details: object = {}) {
  await tx.query(
    "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, $3, $4, $5, $6)",
    [p.userId, customerId, action, targetType, targetId, JSON.stringify(details)],
  );
}

// ---------------------------------------------------------------- time entries

export interface TimeEntry {
  id: string;
  customerId: string;
  customerName: string;
  ticketId: string | null;
  ticketNumber: number | null;
  ticketTitle: string | null;
  userId: string;
  userName: string;
  workDate: string;
  minutes: number;
  billable: boolean;
  note: string | null;
  billed: boolean;
  canEdit: boolean;
}

const ENTRY_SELECT = `
  select e.*, c.name as customer_name, t.number as ticket_number, t.title as ticket_title, u.display_name as user_name
    from time_entries e
    join customers c on c.id = e.customer_id
    join users u on u.id = e.user_id
    left join tickets t on t.id = e.ticket_id`;

function toEntry(r: Record<string, unknown>, p: Principal): TimeEntry {
  const customerId = r.customer_id as string;
  const billed = Boolean(r.billed_at);
  const manager = p.memberships.some((m) => m.customerId === customerId && m.role === "service_manager");
  return {
    id: r.id as string,
    customerId,
    customerName: r.customer_name as string,
    ticketId: (r.ticket_id as string) ?? null,
    ticketNumber: r.ticket_number ? Number(r.ticket_number) : null,
    ticketTitle: (r.ticket_title as string) ?? null,
    userId: r.user_id as string,
    userName: r.user_name as string,
    workDate: dateOnly(r.work_date)!,
    minutes: Number(r.minutes),
    billable: Boolean(r.billable),
    note: (r.note as string) ?? null,
    billed,
    canEdit: !billed && (r.user_id === p.userId || manager),
  };
}

const durationField = z
  .union([z.number().int(), z.string()])
  .transform((v, ctx) => {
    const n = typeof v === "number" ? v : parseDuration(v);
    if (n === null || n < 1 || n > 1440) {
      ctx.addIssue({ code: "custom", message: "Enter a time like 30m, 1h or 1h 30m (up to 24 hours)." });
      return z.NEVER;
    }
    return n;
  });

const entryFields = {
  workDate: z.iso.date({ error: "Choose a date." }),
  minutes: durationField,
  billable: z.boolean().default(true),
  note: z
    .string()
    .trim()
    .max(1000)
    .refine((s) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s), "Contains invalid characters.")
    .optional()
    .default(""),
};

export const logTimeSchema = z
  .object({
    ticketId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    /** A request number for the chosen client, as typed on the timesheet ("#123" or "123"). */
    ticketNumber: z.union([z.number().int().positive(), z.string().trim().regex(/^#?\d{1,12}$/).transform((x) => Number(x.replace("#", "")))]).optional(),
    ...entryFields,
  })
  .refine((v) => v.ticketId || v.customerId, { error: "Choose a client.", path: ["customerId"] });

export const updateTimeSchema = z.object({
  workDate: entryFields.workDate.optional(),
  minutes: durationField.optional(),
  billable: z.boolean().optional(),
  note: entryFields.note,
});

function checkDate(workDate: string) {
  // No future time, and nothing older than a year (it would have been invoiced).
  const today = todayPacific();
  const yearAgo = new Date(Date.parse(`${today}T12:00:00Z`) - 366 * 864e5).toISOString().slice(0, 10);
  if (workDate > today) throw new AppError(422, "validation_failed", "Time can't be logged in the future.", { field: "workDate" });
  if (workDate < yearAgo) throw new AppError(422, "validation_failed", "That date is more than a year ago.", { field: "workDate" });
}

/** Refuses time in a month already invoiced for the client (database function: technicians can't read billing data). */
async function lockedMonth(tx: Queryable, customerId: string, workDate: string) {
  const r = await tx.query<{ locked: boolean }>("select app_month_locked($1, $2) as locked", [customerId, workDate.slice(0, 7)]);
  if (r.rows[0]?.locked) throw new AppError(409, "invalid_transition", `${workDate.slice(0, 7)} has already been invoiced for this client. Ask an operator to reopen it.`);
}

export async function logTime(p: Principal, raw: unknown) {
  const v = logTimeSchema.parse(raw);
  checkDate(v.workDate);
  return withUser(p.userId, async (tx) => {
    let customerId = v.customerId;
    let ticketId = v.ticketId ?? null;
    if (!ticketId && v.ticketNumber && customerId) {
      const t = await tx.query<{ id: string }>("select id from tickets where number = $1 and customer_id = $2", [v.ticketNumber, customerId]);
      if (!t.rows[0]) throw new AppError(422, "validation_failed", `Request #${v.ticketNumber} isn't one of this client's.`, { field: "ticketNumber" });
      ticketId = t.rows[0].id;
    }
    if (v.ticketId) {
      const t = await tx.query<{ customer_id: string }>("select customer_id from tickets where id = $1", [v.ticketId]);
      if (!t.rows[0]) throw notFound("Ticket");
      customerId = t.rows[0].customer_id;
    }
    if (!customerId || !isStaffFor(p, customerId)) throw forbidden("Only technicians for this client can log time.");
    await lockedMonth(tx, customerId, v.workDate);
    const r = await tx.query<{ id: string }>(
      `insert into time_entries (customer_id, ticket_id, user_id, work_date, minutes, billable, note)
       values ($1, $2, $3, $4, $5, $6, nullif($7, '')) returning id`,
      [customerId, ticketId, p.userId, v.workDate, v.minutes, v.billable, v.note],
    );
    await audit(tx, p, customerId, "time.log", "time_entry", r.rows[0].id, { minutes: v.minutes, billable: v.billable, ticketId });
    return { id: r.rows[0].id };
  });
}

async function editableEntry(tx: Queryable, p: Principal, id: string) {
  if (!UUID.test(id)) throw notFound("Time entry");
  const r = await tx.query<Record<string, unknown>>("select * from time_entries where id = $1", [id]);
  const e = r.rows[0];
  if (!e) throw notFound("Time entry");
  const customerId = e.customer_id as string;
  if (e.billed_at) throw new AppError(409, "invalid_transition", "This time has been invoiced and can't be changed. Ask an operator to reopen the month.");
  const manager = p.memberships.some((m) => m.customerId === customerId && m.role === "service_manager");
  if (e.user_id !== p.userId && !manager) throw forbidden("You can only change your own time.");
  return e;
}

export async function updateTimeEntry(p: Principal, id: string, raw: unknown) {
  const v = updateTimeSchema.parse(raw);
  if (v.workDate) checkDate(v.workDate);
  return withUser(p.userId, async (tx) => {
    const e = await editableEntry(tx, p, id);
    const customerId = e.customer_id as string;
    if (v.workDate) await lockedMonth(tx, customerId, v.workDate);
    await tx.query(
      `update time_entries set work_date = coalesce($2, work_date), minutes = coalesce($3, minutes), billable = coalesce($4, billable),
              note = case when $5::boolean then nullif($6, '') else note end, updated_at = now() where id = $1`,
      [id, v.workDate ?? null, v.minutes ?? null, v.billable ?? null, raw !== null && typeof raw === "object" && "note" in raw, v.note],
    );
    await audit(tx, p, customerId, "time.update", "time_entry", id, { minutes: v.minutes ?? null, billable: v.billable ?? null });
    return { ok: true };
  });
}

export async function deleteTimeEntry(p: Principal, id: string) {
  return withUser(p.userId, async (tx) => {
    const e = await editableEntry(tx, p, id);
    await tx.query("delete from time_entries where id = $1", [id]);
    await audit(tx, p, e.customer_id as string, "time.delete", "time_entry", id, { minutes: Number(e.minutes) });
    return { ok: true };
  });
}

/** Time on one ticket (technicians). */
export async function ticketTime(p: Principal, ticketId: string) {
  if (!UUID.test(ticketId)) throw notFound("Ticket");
  return withUser(p.userId, async (tx) => {
    const t = await tx.query<{ customer_id: string }>("select customer_id from tickets where id = $1", [ticketId]);
    if (!t.rows[0] || !isStaffFor(p, t.rows[0].customer_id)) throw notFound("Ticket");
    const r = await tx.query(`${ENTRY_SELECT} where e.ticket_id = $1 order by e.work_date desc, e.created_at desc`, [ticketId]);
    const entries = r.rows.map((x) => toEntry(x, p));
    return {
      entries,
      totalMinutes: entries.reduce((n, e) => n + e.minutes, 0),
      billableMinutes: entries.filter((e) => e.billable).reduce((n, e) => n + e.minutes, 0),
    };
  });
}

/** Monday of the week containing a date. */
export function weekStart(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - day * 864e5).toISOString().slice(0, 10);
}

/** A week of one person's time (their own; service managers can look at their technicians). */
export async function timesheet(p: Principal, opts: { week?: string; userId?: string } = {}) {
  if (!isStaffAnywhere(p)) throw forbidden("Only technicians have a timesheet.");
  const start = weekStart(opts.week && /^\d{4}-\d{2}-\d{2}$/.test(opts.week) ? opts.week : todayPacific());
  const end = new Date(Date.parse(`${start}T12:00:00Z`) + 6 * 864e5).toISOString().slice(0, 10);
  const userId = opts.userId && UUID.test(opts.userId) ? opts.userId : p.userId;
  const managerOf = customersWhere(p, (r) => r === "service_manager");
  if (userId !== p.userId && managerOf.length === 0) throw forbidden("Only service managers can view other timesheets.");
  return withUser(p.userId, async (tx) => {
    const params: unknown[] = [userId, start, end];
    let scope = "";
    if (userId !== p.userId) {
      params.push(managerOf);
      scope = "and e.customer_id = any($4::uuid[])";
    }
    const r = await tx.query(`${ENTRY_SELECT} where e.user_id = $1 and e.work_date between $2 and $3 ${scope} order by e.work_date, e.created_at`, params);
    const entries = r.rows.map((x) => toEntry(x, p));
    const people =
      managerOf.length > 0
        ? (
            await tx.query<{ id: string; display_name: string }>(
              `select distinct u.id, u.display_name from memberships m join users u on u.id = m.user_id
                where m.customer_id = any($1::uuid[]) and m.revoked_at is null and m.role = any($2) and u.status = 'active' order by u.display_name`,
              [managerOf, STAFF_ROLES],
            )
          ).rows.map((u) => ({ id: u.id, name: u.display_name }))
        : [];
    return {
      weekStart: start,
      weekEnd: end,
      userId,
      entries,
      totalMinutes: entries.reduce((n, e) => n + e.minutes, 0),
      billableMinutes: entries.filter((e) => e.billable).reduce((n, e) => n + e.minutes, 0),
      people,
      clients: p.memberships.filter((m) => STAFF_ROLES.includes(m.role)).map((m) => ({ id: m.customerId, name: m.customerName })),
    };
  });
}

// ---------------------------------------------------------------- contracts (operators)

export interface Contract extends ContractTerms {
  id: string;
  customerId: string;
  name: string;
  startsOn: string;
  endsOn: string | null;
  notes: string | null;
}

function toContract(r: Record<string, unknown>): Contract {
  return {
    id: r.id as string,
    customerId: r.customer_id as string,
    name: r.name as string,
    kind: r.kind as ContractKind,
    monthlyFeeCents: Number(r.monthly_fee_cents),
    includedMinutes: Number(r.included_minutes),
    hourlyRateCents: Number(r.hourly_rate_cents),
    roundingMinutes: Number(r.rounding_minutes),
    startsOn: dateOnly(r.starts_on)!,
    endsOn: dateOnly(r.ends_on),
    notes: (r.notes as string) ?? null,
  };
}

const dollars = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
      ctx.addIssue({ code: "custom", message: "Enter an amount in dollars." });
      return z.NEVER;
    }
    return Math.round(n * 100);
  });

export const contractSchema = z
  .object({
    name: z.string().trim().min(1, { error: "Name the plan." }).max(120),
    kind: z.enum(["retainer", "block", "hourly"]),
    monthlyFee: dollars.default(0),
    includedHours: z.coerce.number().min(0).max(100000).default(0),
    hourlyRate: dollars,
    roundingMinutes: z.coerce.number().pipe(z.union([z.literal(1), z.literal(6), z.literal(10), z.literal(15), z.literal(30), z.literal(60)])).default(15),
    startsOn: z.iso.date(),
    endsOn: z.union([z.iso.date(), z.literal(""), z.null()]).optional(),
    notes: z.string().trim().max(2000).optional().default(""),
  })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, { error: "The end date must be after the start date.", path: ["endsOn"] })
  .refine((v) => v.kind === "hourly" || v.includedHours > 0, { error: "How many hours does the plan include?", path: ["includedHours"] });

async function activeContract(tx: Queryable, customerId: string) {
  const r = await tx.query("select * from customer_contracts where customer_id = $1 and active", [customerId]);
  return r.rows[0] ? toContract(r.rows[0]) : null;
}

export async function getContract(p: Principal, customerId: string) {
  requireOperator(p);
  if (!UUID.test(customerId)) throw notFound("Client");
  return asSystem((tx) => activeContract(tx, customerId));
}

/** Sets the client's plan. A changed plan replaces the active one; the old one is kept for history. */
export async function saveContract(p: Principal, customerId: string, raw: unknown) {
  requireOperator(p);
  const v = contractSchema.parse(raw);
  if (!UUID.test(customerId)) throw notFound("Client");
  return asSystem(async (tx) => {
    const c = await tx.query("select 1 from customers where id = $1", [customerId]);
    if (!c.rows[0]) throw notFound("Client");
    await tx.query("update customer_contracts set active = false, updated_at = now() where customer_id = $1 and active", [customerId]);
    const r = await tx.query<{ id: string }>(
      `insert into customer_contracts (customer_id, name, kind, monthly_fee_cents, included_minutes, hourly_rate_cents, rounding_minutes, starts_on, ends_on, notes, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, nullif($9, '')::date, nullif($10, ''), $11) returning id`,
      [
        customerId, v.name, v.kind, v.kind === "retainer" ? v.monthlyFee : 0, v.kind === "hourly" ? 0 : Math.round(v.includedHours * 60),
        v.hourlyRate, v.roundingMinutes, v.startsOn, v.endsOn ?? "", v.notes, p.userId,
      ],
    );
    await audit(tx, p, customerId, "billing.contract", "contract", r.rows[0].id, { kind: v.kind, name: v.name });
    return { id: r.rows[0].id };
  });
}

export async function endContract(p: Principal, customerId: string) {
  requireOperator(p);
  return asSystem(async (tx) => {
    const r = await tx.query<{ id: string }>("update customer_contracts set active = false, updated_at = now() where customer_id = $1 and active returning id", [customerId]);
    if (!r.rows[0]) throw notFound("Contract");
    await audit(tx, p, customerId, "billing.contract_end", "contract", r.rows[0].id);
    return { ok: true };
  });
}

// ---------------------------------------------------------------- monthly billing (operators)

export interface ClientMonth {
  customerId: string;
  customerName: string;
  month: string;
  contract: Contract | null;
  totals: MonthTotals;
  entryCount: number;
  finalized: { at: string; byName: string | null } | null;
}

/** The contract that applies to a month: the active one, if it covers any of the month. */
function contractFor(c: Contract | null, month: string) {
  if (!c) return null;
  const { from, to } = monthRange(month);
  return c.startsOn <= to && (!c.endsOn || c.endsOn >= from) ? c : null;
}

async function monthFor(tx: Queryable, customerId: string, month: string): Promise<Omit<ClientMonth, "customerName"> & { entries: Record<string, unknown>[] }> {
  const { from, to } = monthRange(month);
  const exp = await tx.query<{ totals: MonthTotals & { contract?: Contract | null }; created_at: string; display_name: string | null }>(
    "select x.totals, x.created_at, u.display_name from billing_exports x left join users u on u.id = x.created_by where x.customer_id = $1 and x.month = $2",
    [customerId, month],
  );
  const entries = (await tx.query(`${ENTRY_SELECT} where e.customer_id = $1 and e.work_date between $2 and $3 order by e.work_date, e.created_at`, [customerId, from, to])).rows;
  if (exp.rows[0]) {
    // A finalized month shows what was invoiced, not today's recalculation.
    const { contract = null, ...totals } = exp.rows[0].totals;
    return {
      customerId, month, contract, totals: totals as MonthTotals, entryCount: entries.length, entries,
      finalized: { at: iso(exp.rows[0].created_at)!, byName: exp.rows[0].display_name },
    };
  }
  const contract = contractFor(await activeContract(tx, customerId), month);
  let prior = 0;
  if (contract?.kind === "block" && contract.startsOn < from) {
    const before = await tx.query<{ minutes: number }>(
      "select minutes from time_entries where customer_id = $1 and billable and work_date >= $2 and work_date < $3",
      [customerId, contract.startsOn, from],
    );
    prior = before.rows.reduce((n, e) => n + roundEntry(Number(e.minutes), contract.roundingMinutes), 0);
  }
  const counted = contract?.kind === "block" ? entries.filter((e) => dateOnly(e.work_date)! >= contract.startsOn) : entries;
  const totals = computeMonth(contract, counted.map((e) => ({ minutes: Number(e.minutes), billable: Boolean(e.billable) })), prior);
  return { customerId, month, contract, totals, entryCount: entries.length, entries, finalized: null };
}

const checkMonth = (month: string) => {
  if (!MONTH.test(month)) throw new AppError(422, "validation_failed", "Choose a month.", { field: "month" });
};

export async function billingOverview(p: Principal, month: string): Promise<ClientMonth[]> {
  requireOperator(p);
  checkMonth(month);
  return asSystem(async (tx) => {
    const customers = await tx.query<{ id: string; name: string }>("select id, name from customers where status <> 'offboarded' order by name");
    const out: ClientMonth[] = [];
    for (const c of customers.rows) {
      const m = await monthFor(tx, c.id, month);
      const { entries, ...rest } = m;
      void entries;
      out.push({ ...rest, customerName: c.name });
    }
    return out;
  });
}

export async function billingDetail(p: Principal, customerId: string, month: string) {
  requireOperator(p);
  checkMonth(month);
  if (!UUID.test(customerId)) throw notFound("Client");
  return asSystem(async (tx) => {
    const c = await tx.query<{ name: string }>("select name from customers where id = $1", [customerId]);
    if (!c.rows[0]) throw notFound("Client");
    const m = await monthFor(tx, customerId, month);
    const { entries, ...rest } = m;
    return { ...rest, customerName: c.rows[0].name, entries: entries.map((e) => toEntry(e, p)), activeContract: await activeContract(tx, customerId) };
  });
}

/** Invoice-ready CSV: one line per entry, then the month's summary. Formulas are neutralised. */
export async function billingCsv(p: Principal, customerId: string, month: string) {
  const d = await billingDetail(p, customerId, month);
  const inc = d.contract?.roundingMinutes ?? 1;
  const rows = [
    ["Date", "Request", "Technician", "Description", "Minutes", "Billed minutes", "Hours", "Billable"],
    ...d.entries.map((e) => {
      const billed = e.billable ? roundEntry(e.minutes, inc) : 0;
      return [
        e.workDate,
        e.ticketNumber ? `#${e.ticketNumber}` : "",
        e.userName,
        [e.ticketTitle, e.note].filter(Boolean).join(": ") || "General support",
        e.minutes,
        billed,
        decimalHours(billed),
        e.billable ? "Yes" : "No",
      ];
    }),
    [],
    ["Client", d.customerName],
    ["Month", month],
    ["Plan", d.contract ? `${d.contract.name} (${d.contract.kind})` : "No plan"],
    ["Billable hours", decimalHours(d.totals.billableMinutes)],
    ["Included hours available", decimalHours(d.totals.includedAvailableMinutes)],
    ["Overage hours", decimalHours(d.totals.overageMinutes)],
    ["Plan fee (USD)", (d.totals.feeCents / 100).toFixed(2)],
    ["Overage (USD)", (d.totals.overageCents / 100).toFixed(2)],
    ["Total (USD)", (d.totals.totalCents / 100).toFixed(2)],
  ];
  return { filename: `billing-${month}-${d.customerName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase()}.csv`, csv: rows.map((r) => r.map(csvCell).join(",")).join("\r\n") };
}

/** Records the month as invoiced and locks its entries. */
export async function finalizeMonth(p: Principal, customerId: string, month: string) {
  requireOperator(p);
  checkMonth(month);
  if (month >= currentMonthPacific()) throw new AppError(422, "validation_failed", "A month can be finalized once it has ended.");
  return asSystem(async (tx) => {
    const m = await monthFor(tx, customerId, month);
    if (m.finalized) throw new AppError(409, "invalid_transition", "This month is already finalized.");
    const x = await tx.query<{ id: string }>(
      "insert into billing_exports (customer_id, month, totals, created_by) values ($1, $2, $3, $4) returning id",
      [customerId, month, JSON.stringify({ ...m.totals, contract: m.contract }), p.userId],
    );
    const { from, to } = monthRange(month);
    const locked = await tx.query(
      "update time_entries set billed_at = now(), billing_export_id = $4 where customer_id = $1 and work_date between $2 and $3 and billed_at is null",
      [customerId, from, to, x.rows[0].id],
    );
    await audit(tx, p, customerId, "billing.finalize", "billing_export", x.rows[0].id, { month, totalCents: m.totals.totalCents, entries: locked.rowCount });
    return { id: x.rows[0].id, entries: locked.rowCount };
  });
}

/** Undoes a finalize (for corrections before re-invoicing). */
export async function reopenMonth(p: Principal, customerId: string, month: string) {
  requireOperator(p);
  checkMonth(month);
  return asSystem(async (tx) => {
    const x = await tx.query<{ id: string }>("select id from billing_exports where customer_id = $1 and month = $2", [customerId, month]);
    if (!x.rows[0]) throw new AppError(409, "invalid_transition", "This month isn't finalized.");
    await tx.query("update time_entries set billed_at = null, billing_export_id = null where billing_export_id = $1", [x.rows[0].id]);
    await tx.query("delete from billing_exports where id = $1", [x.rows[0].id]);
    await audit(tx, p, customerId, "billing.reopen", "billing_export", x.rows[0].id, { month });
    return { ok: true };
  });
}

// ---------------------------------------------------------------- what clients see

export interface PlanUsage {
  planName: string;
  kind: ContractKind;
  month: string;
  usedMinutes: number;
  includedMinutes: number | null;
  /** Block plans: hours left after this month so far. */
  remainingMinutes: number | null;
}

/** Hours used against the client's plan, for its administrators and staff. No notes, rates or amounts. */
export async function planUsage(p: Principal, customerId: string, month = currentMonthPacific()): Promise<PlanUsage | null> {
  if (!canSeeOrgFor(p, customerId)) throw forbidden();
  checkMonth(month);
  return asSystem(async (tx) => {
    const m = await monthFor(tx, customerId, month);
    if (!m.contract) return null;
    return {
      planName: m.contract.name,
      kind: m.contract.kind,
      month,
      usedMinutes: m.totals.billableMinutes,
      includedMinutes: m.contract.kind === "hourly" ? null : m.totals.includedAvailableMinutes,
      remainingMinutes: m.totals.blockBalanceAfterMinutes,
    };
  });
}
