import { z } from "zod";
import { asSystem, withUser, type Queryable } from "../db";
import { isStaffFor, requireOperator, type Principal } from "../authz";
import { AppError, forbidden, notFound } from "../errors";
import { emitTicketEvent } from "../notify/service";
import { applySlaTransition } from "../sla/service";
import { addMessage } from "../tickets/service";
import type { Status } from "../tickets/schemas";
import { insertAsset, portalPrimaryUser } from "../assets/service";
import { ASSET_KINDS, KIND_LABEL, isComputer } from "../assets/naming";
import type { DeliveryMethod, HardwareStage } from "./read";

/**
 * Hardware requests: a catalog request whose item uses the "hardware"
 * workflow moves through approval -> ordering -> ordered -> received ->
 * delivered. Approval sends it to the ordering queue; receiving registers
 * each item as a tagged asset (serial, model, requester as owner), links it
 * to the request and sends it to the technicians' queue; delivery resolves the
 * request. Computers are always set up by a technician.
 */

// ---------------------------------------------------------------- routing

async function routingQueues(tx: Queryable) {
  const r = await tx.query<{ order_queue_id: string | null; delivery_queue_id: string | null }>(
    "select order_queue_id, delivery_queue_id from hardware_settings limit 1",
  );
  return { order: r.rows[0]?.order_queue_id ?? null, delivery: r.rows[0]?.delivery_queue_id ?? null };
}

/**
 * The ticket columns that send it to a stage's queue, unassigned so the team
 * picks it up. Callers fold these into their own ticket update; returns the
 * history entries to record.
 */
export async function routeChanges(tx: Queryable, which: "order" | "delivery", current: { queueId: string | null; assigneeId: string | null }) {
  const queueId = (await routingQueues(tx))[which];
  const sets: string[] = [];
  const params: unknown[] = [];
  const events: [string, string | null, string | null][] = [];
  if (queueId && queueId !== current.queueId) {
    params.push(queueId);
    sets.push(`queue_id = $Q${params.length}`);
    const name = (await tx.query<{ name: string }>("select name from queues where id = $1", [queueId])).rows[0]?.name ?? null;
    events.push(["queue_changed", null, name]);
  }
  if (current.assigneeId) {
    sets.push("assignee_user_id = null");
    events.push(["assigned", current.assigneeId, null]);
  }
  return { sets, params, events };
}

/** Applies routeChanges' column list to a ticket update whose own parameters come first. */
function placeholders(sets: string[], offset: number) {
  return sets.map((s) => s.replace(/\$Q(\d+)/g, (_, n: string) => `$${offset + Number(n)}`));
}

async function recordEvents(tx: Queryable, ticketId: string, customerId: string, actorId: string, events: [string, string | null, string | null][]) {
  for (const [kind, from, to] of events) {
    await tx.query(
      "insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, from_value, to_value) values ($1, $2, $3, $4, $5, $6)",
      [ticketId, customerId, actorId, kind, from, to],
    );
  }
}

/**
 * Called in the submitter's transaction for a hardware catalog item. An
 * already-approved request (submitted by an approver) goes straight to ordering.
 */
export async function openHardwareOrder(tx: Queryable, p: Principal, ticketId: string, customerId: string, approved: boolean) {
  await tx.query("insert into hardware_orders (ticket_id, customer_id, stage) values ($1, $2, $3)", [ticketId, customerId, approved ? "ordering" : "approval"]);
  if (approved) await sendToOrdering(tx, p, ticketId, customerId);
}

/** Moves an approved request to the ordering queue. Runs in the approver's (or submitter's) transaction. */
export async function sendToOrdering(tx: Queryable, p: Principal, ticketId: string, customerId: string) {
  const t = await tx.query<{ queue_id: string | null; assignee_user_id: string | null }>("select queue_id, assignee_user_id from tickets where id = $1", [ticketId]);
  if (!t.rows[0]) return;
  const h = await tx.query("update hardware_orders set stage = 'ordering', updated_at = now() where ticket_id = $1 and stage in ('approval', 'ordering') returning ticket_id", [ticketId]);
  // Not a hardware request: nothing to route.
  if (!h.rowCount) return;
  const route = await routeChanges(tx, "order", { queueId: t.rows[0].queue_id, assigneeId: t.rows[0].assignee_user_id });
  if (route.sets.length) {
    await tx.query(`update tickets set ${placeholders(route.sets, 1).join(", ")}, updated_at = now(), version = version + 1 where id = $1`, [ticketId, ...route.params]);
    await recordEvents(tx, ticketId, customerId, p.userId, route.events);
  }
}

export async function cancelHardwareOrder(tx: Queryable, ticketId: string) {
  await tx.query("update hardware_orders set stage = 'cancelled', updated_at = now() where ticket_id = $1 and stage = 'approval'", [ticketId]);
}

// ---------------------------------------------------------------- staff actions

async function staffOrder(tx: Queryable, p: Principal, ticketId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) throw notFound("Ticket");
  // Permission first, on a plain read: the row lock below only sees rows the caller may update.
  const seen = await tx.query<{ customer_id: string }>("select customer_id from hardware_orders where ticket_id = $1", [ticketId]);
  const cust = seen.rows[0]?.customer_id;
  if (!cust || !p.memberships.some((m) => m.customerId === cust)) throw notFound("Ticket");
  if (!isStaffFor(p, cust)) throw forbidden("Only technicians can update a hardware order.");
  const r = await tx.query<{
    customer_id: string; stage: HardwareStage; delivery_method: DeliveryMethod | null; number: string; status: Status;
    requester_user_id: string; queue_id: string | null; assignee_user_id: string | null; ordered_at: string | null;
  }>(
    `select h.customer_id, h.stage, h.delivery_method, t.number, t.status, t.requester_user_id, t.queue_id, t.assignee_user_id, h.ordered_at
       from hardware_orders h join tickets t on t.id = h.ticket_id where h.ticket_id = $1 for update of h`,
    [ticketId],
  );
  const o = r.rows[0];
  if (!o || !p.memberships.some((m) => m.customerId === o.customer_id)) throw notFound("Ticket");
  if (!isStaffFor(p, o.customer_id)) throw forbidden("Only technicians can update a hardware order.");
  return o;
}

const moved = () => new AppError(409, "invalid_transition", "This order has already moved on. Reload to see where it is.");

const text = (max: number) => z.string().trim().max(max);

export const orderedSchema = z.object({
  vendor: text(120).optional().default(""),
  orderRef: text(120).optional().default(""),
  expectedOn: z.union([z.iso.date(), z.literal("")]).optional().default(""),
});

/** Ordering -> ordered (or edit the order details while waiting for delivery). */
export async function markOrdered(p: Principal, ticketId: string, raw: unknown) {
  const v = orderedSchema.parse(raw);
  const first = await withUser(p.userId, async (tx) => {
    const o = await staffOrder(tx, p, ticketId);
    if (o.stage !== "ordering" && o.stage !== "ordered") throw moved();
    await tx.query(
      `update hardware_orders set stage = 'ordered', vendor = nullif($2, ''), order_ref = nullif($3, ''), expected_on = nullif($4, '')::date,
              ordered_at = coalesce(ordered_at, now()), ordered_by = coalesce(ordered_by, $5), updated_at = now() where ticket_id = $1`,
      [ticketId, v.vendor, v.orderRef, v.expectedOn, p.userId],
    );
    if (o.stage === "ordering") {
      await setInProgress(tx, ticketId, o.customer_id, o.status, p.userId);
      await recordEvents(tx, ticketId, o.customer_id, p.userId, [["hardware_ordered", null, v.expectedOn || null]]);
    }
    await tx.query("update tickets set updated_at = now(), version = version + 1 where id = $1", [ticketId]);
    await audit(tx, p, o.customer_id, ticketId, "hardware.ordered", { vendor: v.vendor || null, expectedOn: v.expectedOn || null });
    return o.stage === "ordering";
  });
  if (first) {
    const when = v.expectedOn ? ` It should arrive around ${formatDay(v.expectedOn)}.` : "";
    await addMessage(p, ticketId, { body: `Your hardware has been ordered.${when} We'll let you know when it arrives.`, visibility: "public" });
  }
  return { stage: "ordered" as const };
}

export const receiveSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(ASSET_KINDS),
        serialNumber: z
          .string()
          .trim()
          .min(2, { error: "Scan or type the serial number." })
          .max(80)
          .refine((s) => !/[\u0000-\u001F\u007F]/.test(s), "Contains control characters."),
        manufacturer: text(80).optional().default(""),
        model: text(120).optional().default(""),
      }),
    )
    .min(1, { error: "Add at least one item." })
    .max(20),
  deliveryMethod: z.enum(["tech_setup", "user_setup"]),
});

/**
 * Ordered -> received: registers each item as an asset owned by the
 * requester, links it to the request and sends the request to the
 * technicians' queue. Serial numbers must be new for this company.
 */
export async function receiveHardware(p: Principal, ticketId: string, raw: unknown) {
  const v = receiveSchema.parse(raw);
  const serials = v.items.map((i) => i.serialNumber.toUpperCase());
  if (new Set(serials).size !== serials.length) throw new AppError(422, "validation_failed", "The same serial number is listed twice.", { field: "items" });
  if (v.deliveryMethod === "user_setup" && v.items.some((i) => isComputer(i.kind))) {
    throw new AppError(422, "validation_failed", "Computers are always set up by a technician.", { field: "deliveryMethod" });
  }
  // Who it's for, resolved before the write transaction (as asset registration does).
  const pre = await withUser(p.userId, (tx) => staffOrder(tx, p, ticketId));
  const owner = await portalPrimaryUser(pre.customer_id, pre.requester_user_id);

  const result = await withUser(p.userId, async (tx) => {
    const o = await staffOrder(tx, p, ticketId);
    if (o.stage !== "ordering" && o.stage !== "ordered") throw moved();
    const dupes = await tx.query<{ tag: string; serial_number: string }>(
      "select tag, serial_number from assets where customer_id = $1 and status = 'active' and upper(serial_number) = any($2::text[])",
      [o.customer_id, serials],
    );
    if (dupes.rows[0]) {
      throw new AppError(409, "validation_failed", `Serial ${dupes.rows[0].serial_number} is already registered as ${dupes.rows[0].tag}.`, { field: "items" });
    }
    const today = new Date().toISOString().slice(0, 10);
    const purchased = o.ordered_at ? new Date(o.ordered_at).toISOString().slice(0, 10) : today;
    const labels: string[] = [];
    for (const item of v.items) {
      const asset = await insertAsset(
        tx,
        p,
        {
          customerId: o.customer_id,
          kind: item.kind,
          primaryUser: owner.portalUserId ? { source: "portal", userId: owner.portalUserId } : { source: "none" },
          location: "",
          notes: `Received for request #${o.number}.`,
          hardware: { manufacturer: item.manufacturer, model: item.model, serialNumber: item.serialNumber, purchaseDate: purchased },
        },
        owner,
        { ticketNumber: Number(o.number) },
      );
      const what = [item.manufacturer, item.model].filter(Boolean).join(" ") || KIND_LABEL[item.kind];
      const label = `${asset.tag} · ${what} · SN ${item.serialNumber}`.slice(0, 300);
      await tx.query("insert into ticket_assets (ticket_id, asset_id, customer_id, label, linked_by) values ($1, $2, $3, $4, $5)", [
        ticketId, asset.id, o.customer_id, label, p.userId,
      ]);
      labels.push(asset.tag);
    }
    await tx.query(
      `update hardware_orders set stage = 'received', received_at = now(), received_by = $2, delivery_method = $3,
              ordered_at = coalesce(ordered_at, now()), ordered_by = coalesce(ordered_by, $2), updated_at = now() where ticket_id = $1`,
      [ticketId, p.userId, v.deliveryMethod],
    );
    await setInProgress(tx, ticketId, o.customer_id, o.status, p.userId);
    const route = await routeChanges(tx, "delivery", { queueId: o.queue_id, assigneeId: o.assignee_user_id });
    await tx.query(
      `update tickets set ${[...placeholders(route.sets, 1), "updated_at = now()", "version = version + 1"].join(", ")} where id = $1`,
      [ticketId, ...route.params],
    );
    await recordEvents(tx, ticketId, o.customer_id, p.userId, [["hardware_received", null, labels.join(", ")], ...route.events]);
    await audit(tx, p, o.customer_id, ticketId, "hardware.received", { assets: labels, deliveryMethod: v.deliveryMethod });
    return { tags: labels };
  });
  const how =
    v.deliveryMethod === "tech_setup"
      ? "A technician will bring it to you and set it up."
      : "A technician will drop it off for you to set up. Reply here if you need a hand.";
  await addMessage(p, ticketId, { body: `Your hardware has arrived (${result.tags.join(", ")}). ${how}`, visibility: "public" });
  return { stage: "received" as const, tags: result.tags };
}

export const deliveredSchema = z.object({ note: text(1000).optional().default("") });

/** Received -> delivered, which resolves the request with a record of what was handed over. */
export async function markDelivered(p: Principal, ticketId: string, raw: unknown) {
  const v = deliveredSchema.parse(raw);
  return withUser(p.userId, async (tx) => {
    const o = await staffOrder(tx, p, ticketId);
    if (o.stage !== "received") throw moved();
    const items = await tx.query<{ label: string }>("select label from ticket_assets where ticket_id = $1 order by linked_at, label", [ticketId]);
    const setUp = o.delivery_method === "tech_setup";
    const resolution = `${setUp ? "Delivered and set up" : "Delivered for the user to set up"} by ${p.displayName}: ${items.rows.map((i) => i.label).join("; ")}.${v.note ? ` ${v.note}` : ""}`.slice(0, 5000);
    await tx.query(
      "update hardware_orders set stage = 'delivered', delivered_at = now(), delivered_by = $2, updated_at = now() where ticket_id = $1",
      [ticketId, p.userId],
    );
    await tx.query(
      `update tickets set status = 'resolved', resolved_at = now(), resolution_note = $2, updated_at = now(), version = version + 1,
              first_response_at = coalesce(first_response_at, now()) where id = $1`,
      [ticketId, resolution],
    );
    await recordEvents(tx, ticketId, o.customer_id, p.userId, [
      ["hardware_delivered", null, o.delivery_method],
      ["status_changed", o.status, "resolved"],
    ]);
    await applySlaTransition(tx, ticketId, { fromStatus: o.status, toStatus: "resolved" });
    await emitTicketEvent(tx, ticketId, "status_changed", "resolved");
    await audit(tx, p, o.customer_id, ticketId, "hardware.delivered", { deliveryMethod: o.delivery_method });
    return { stage: "delivered" as const };
  });
}

async function setInProgress(tx: Queryable, ticketId: string, customerId: string, status: Status, actorId: string) {
  if (status !== "open") return;
  await tx.query("update tickets set status = 'in_progress' where id = $1", [ticketId]);
  await recordEvents(tx, ticketId, customerId, actorId, [["status_changed", "open", "in_progress"]]);
  await applySlaTransition(tx, ticketId, { fromStatus: "open", toStatus: "in_progress" });
}

async function audit(tx: Queryable, p: Principal, customerId: string, ticketId: string, action: string, details: object) {
  await tx.query(
    "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, $3, 'ticket', $4, $5)",
    [p.userId, customerId, action, ticketId, JSON.stringify(details)],
  );
}

function formatDay(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------- settings (operators)

export interface HardwareSettings {
  orderQueueId: string | null;
  deliveryQueueId: string | null;
}

export async function getHardwareSettings(p: Principal): Promise<HardwareSettings> {
  requireOperator(p);
  return asSystem(async (tx) => {
    const q = await routingQueues(tx);
    return { orderQueueId: q.order, deliveryQueueId: q.delivery };
  });
}

export const settingsSchema = z.object({ orderQueueId: z.uuid().nullable(), deliveryQueueId: z.uuid().nullable() });

export async function saveHardwareSettings(p: Principal, raw: unknown) {
  requireOperator(p);
  const v = settingsSchema.parse(raw);
  return asSystem(async (tx) => {
    for (const id of [v.orderQueueId, v.deliveryQueueId]) {
      if (id && !(await tx.query("select 1 from queues where id = $1", [id])).rows[0]) {
        throw new AppError(422, "validation_failed", "That queue no longer exists.");
      }
    }
    await tx.query(
      `insert into hardware_settings (id, order_queue_id, delivery_queue_id, updated_by, updated_at) values (true, $1, $2, $3, now())
       on conflict (id) do update set order_queue_id = $1, delivery_queue_id = $2, updated_by = $3, updated_at = now()`,
      [v.orderQueueId, v.deliveryQueueId, p.userId],
    );
    await tx.query(
      "insert into audit_events (actor_user_id, action, target_type, target_id, details) values ($1, 'hardware.settings', 'settings', 'hardware', $2)",
      [p.userId, JSON.stringify(v)],
    );
    return v;
  });
}
