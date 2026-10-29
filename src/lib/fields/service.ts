import { z } from "zod";
import { asSystem, withUser, type Queryable } from "../db";
import { isStaffFor, requireOperator, type Principal } from "../authz";
import { AppError, forbidden, notFound } from "../errors";
import { CATEGORIES, type Category } from "../tickets/schemas";
import { appliesTo, FIELD_KINDS, type FieldDef, type FieldKind, type FieldValue } from "./kinds";

export { appliesTo, FIELD_KINDS, FIELD_KIND_LABEL, type FieldDef, type FieldKind, type FieldValue } from "./kinds";

/**
 * Custom fields on regular tickets. A field applies to one client or all of
 * them, and to one category or all of them. Requesters answer the
 * client-facing ones on the new-request form (required ones must be
 * answered there); technicians see and change all of them on the ticket.
 * Staff-only fields and their values never reach the client (RLS too).
 * Catalog requests have their own forms and don't use these.
 */

const toDef = (r: Record<string, unknown>): FieldDef => ({
  id: String(r.id),
  customerId: (r.customer_id as string) ?? null,
  category: (r.category as Category) ?? null,
  label: String(r.label),
  help: (r.help as string) ?? null,
  kind: r.kind as FieldKind,
  options: (r.options as string[]) ?? [],
  required: Boolean(r.required),
  staffOnly: Boolean(r.staff_only),
  position: Number(r.position),
  active: Boolean(r.active),
});

// ---------------------------------------------------------------- definitions (platform operators)

const defSchema = z
  .object({
    customerId: z.uuid().nullable().default(null),
    category: z.enum(CATEGORIES).nullable().default(null),
    label: z
      .string()
      .transform((s) => s.trim().replace(/\s+/g, " "))
      .pipe(z.string().min(1, { error: "Name the field." }).max(80, { error: "Keep the name under 80 characters." })),
    help: z
      .string()
      .max(200, { error: "Keep the hint under 200 characters." })
      .nullable()
      .default(null)
      .transform((s) => s?.trim() || null),
    kind: z.enum(FIELD_KINDS, { error: "Choose a field type." }),
    options: z
      .array(z.string().transform((s) => s.trim()))
      .max(50, { error: "Keep the list to 50 choices." })
      .default([])
      .transform((o) => [...new Set(o.filter(Boolean).map((s) => s.slice(0, 100)))]),
    required: z.boolean().default(false),
    staffOnly: z.boolean().default(false),
    position: z.number().int().min(0).max(10000).default(100),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "select" && v.options.length < 2) ctx.addIssue({ code: "custom", path: ["options"], message: "A choice list needs at least two choices." });
    if (v.kind === "checkbox" && v.required) ctx.addIssue({ code: "custom", path: ["required"], message: "A yes/no field can't be required." });
  });

export async function listFieldDefs(p: Principal): Promise<(FieldDef & { answers: number })[]> {
  requireOperator(p);
  return asSystem(async (tx) => {
    const r = await tx.query<Record<string, unknown>>(
      `select f.*, (select count(*) from ticket_field_values v where v.field_id = f.id)::int as answers
         from ticket_fields f left join customers c on c.id = f.customer_id
        order by c.name nulls first, f.position, f.label`,
    );
    return r.rows.map((x) => ({ ...toDef(x), answers: Number(x.answers) }));
  });
}

const auditField = (tx: Queryable, p: Principal, customerId: string | null, action: string, id: string, details: object) =>
  tx.query("insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, $3, 'ticket_field', $4, $5)", [
    p.userId,
    customerId,
    action,
    id,
    JSON.stringify(details),
  ]);

export async function saveFieldDef(p: Principal, id: string | null, raw: unknown) {
  requireOperator(p);
  const v = defSchema.parse(raw);
  return asSystem(async (tx) => {
    if (v.customerId && !(await tx.query("select 1 from customers where id = $1", [v.customerId])).rows[0]) throw notFound("Client");
    const values = [v.customerId, v.category, v.label, v.help, v.kind, JSON.stringify(v.kind === "select" ? v.options : []), v.required, v.staffOnly, v.position, v.active];
    const r = id
      ? await tx.query<{ id: string }>(
          `update ticket_fields set customer_id = $1, category = $2, label = $3, help = $4, kind = $5, options = $6, required = $7, staff_only = $8,
                  position = $9, active = $10, updated_at = now() where id = $11 returning id`,
          [...values, id],
        )
      : await tx.query<{ id: string }>(
          `insert into ticket_fields (customer_id, category, label, help, kind, options, required, staff_only, position, active)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
          values,
        );
    if (!r.rows[0]) throw notFound("Field");
    await auditField(tx, p, v.customerId, id ? "field.update" : "field.create", r.rows[0].id, { label: v.label, kind: v.kind, category: v.category });
    return { id: r.rows[0].id };
  });
}

/** Deletes a field and every answer to it. Turning it off (active: false) keeps the answers. */
export async function deleteFieldDef(p: Principal, id: string) {
  requireOperator(p);
  return asSystem(async (tx) => {
    const r = await tx.query<{ customer_id: string | null; label: string }>("delete from ticket_fields where id = $1 returning customer_id, label", [id]);
    if (!r.rows[0]) throw notFound("Field");
    await auditField(tx, p, r.rows[0].customer_id, "field.delete", id, { label: r.rows[0].label });
    return { ok: true };
  });
}

// ---------------------------------------------------------------- answers

/** Fields for the new-request form, across the person's clients (the form filters by client and category). */
export async function fieldsForForm(p: Principal): Promise<FieldDef[]> {
  if (!p.memberships.length) return [];
  return withUser(p.userId, async (tx) => {
    const r = await tx.query<Record<string, unknown>>("select * from ticket_fields where active order by position, label");
    return r.rows.map(toDef).filter((f) => !f.staffOnly || (f.customerId ? isStaffFor(p, f.customerId) : p.memberships.some((m) => isStaffFor(p, m.customerId))));
  });
}

const answersSchema = z.record(z.string(), z.union([z.string(), z.boolean(), z.number()]).nullable()).default({});

/** Checks one answer against its field; returns the stored text, or null for "no answer". */
function normalize(f: FieldDef, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const fail = (message: string): never => {
    throw new AppError(422, "validation_failed", `${f.label}: ${message}`, { fields: [{ path: `fields.${f.id}`, message: `${f.label}: ${message}` }] });
  };
  if (f.kind === "checkbox") {
    if (raw === true || raw === "true" || raw === "yes") return "yes";
    if (raw === false || raw === "false" || raw === "no" || raw === "") return null;
    return fail("answer yes or no.");
  }
  const s = String(raw).trim();
  if (!s) return null;
  switch (f.kind) {
    case "text":
      return s.length > 200 ? fail("keep it under 200 characters.") : s;
    case "long_text":
      return s.length > 4000 ? fail("keep it under 4,000 characters.") : s;
    case "number":
      return /^-?\d{1,12}(\.\d{1,4})?$/.test(s) ? s : fail("enter a number.");
    case "date": {
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
      return ok ? s : fail("enter a date.");
    }
    case "select":
      return f.options.includes(s) ? s : fail("choose one of the options.");
  }
  return null;
}

/**
 * Saves answers for a ticket that was just created (same transaction as the
 * ticket). Required client-facing fields must be answered unless the request
 * came in by email, where nobody could answer them.
 */
export async function saveAnswersOnCreate(
  tx: Queryable,
  p: Principal,
  ticket: { id: string; customerId: string; category: string },
  raw: unknown,
  opts: { enforceRequired: boolean },
) {
  const answers = answersSchema.parse(raw ?? {});
  const staff = isStaffFor(p, ticket.customerId);
  const defs = (await tx.query<Record<string, unknown>>("select * from ticket_fields where active")).rows
    .map(toDef)
    .filter((f) => appliesTo(f, ticket.customerId, ticket.category) && (staff || !f.staffOnly));
  for (const f of defs) {
    const value = normalize(f, answers[f.id]);
    if (value === null) {
      if (opts.enforceRequired && f.required && !f.staffOnly) {
        throw new AppError(422, "validation_failed", `Answer "${f.label}".`, { fields: [{ path: `fields.${f.id}`, message: `Answer "${f.label}".` }] });
      }
      continue;
    }
    await tx.query("insert into ticket_field_values (ticket_id, customer_id, field_id, value, updated_by) values ($1, $2, $3, $4, $5)", [
      ticket.id,
      ticket.customerId,
      f.id,
      value,
      p.userId,
    ]);
  }
}

/** The fields that apply to a ticket (plus any with saved answers), as this person may see them. */
export async function ticketFieldsTx(tx: Queryable, p: Principal, ticket: { id: string; customerId: string; category: string; kind: string }): Promise<FieldValue[]> {
  const staff = isStaffFor(p, ticket.customerId);
  const defs = (await tx.query<Record<string, unknown>>("select * from ticket_fields order by position, label")).rows.map(toDef);
  const vals = await tx.query<{ field_id: string; value: string }>("select field_id, value from ticket_field_values where ticket_id = $1", [ticket.id]);
  const byField = new Map(vals.rows.map((v) => [v.field_id, v.value]));
  return defs
    .filter((f) => staff || !f.staffOnly)
    .map((f) => ({ ...f, value: byField.get(f.id) ?? null, applies: ticket.kind !== "request" && appliesTo(f, ticket.customerId, ticket.category) }))
    .filter((f) => f.applies || f.value !== null);
}

/** Technicians change answers on the ticket (an empty answer removes it). */
export async function updateTicketFields(p: Principal, ticketId: string, raw: unknown) {
  const answers = answersSchema.parse(raw ?? {});
  return withUser(p.userId, async (tx) => {
    const t = await tx.query<{ customer_id: string; category: string; kind: string }>("select customer_id, category, kind from tickets where id = $1", [ticketId]);
    const row = t.rows[0];
    if (!row) throw notFound("Ticket");
    if (!isStaffFor(p, row.customer_id)) throw forbidden("Only technicians can change these details.");
    const fields = await ticketFieldsTx(tx, p, { id: ticketId, customerId: row.customer_id, category: row.category, kind: row.kind });
    const changed: string[] = [];
    for (const f of fields) {
      if (!(f.id in answers)) continue;
      const value = normalize(f, answers[f.id]);
      if (value === f.value) continue;
      if (value === null) await tx.query("delete from ticket_field_values where ticket_id = $1 and field_id = $2", [ticketId, f.id]);
      else
        await tx.query(
          `insert into ticket_field_values (ticket_id, customer_id, field_id, value, updated_by) values ($1, $2, $3, $4, $5)
           on conflict (ticket_id, field_id) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
          [ticketId, row.customer_id, f.id, value, p.userId],
        );
      changed.push(f.label);
    }
    if (changed.length) {
      await tx.query("update tickets set updated_at = now() where id = $1", [ticketId]);
      await tx.query(
        "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'ticket.fields', 'ticket', $3, $4)",
        [p.userId, row.customer_id, ticketId, JSON.stringify({ changed })],
      );
    }
    return { changed };
  });
}
