import type { Queryable } from "../db";
import { canSeeOrgFor, isStaffFor, type Principal } from "../authz";

/** Read side of hardware requests, for the ticket view (kept apart from the service to avoid an import cycle). */

export const STAGES = ["approval", "ordering", "ordered", "received", "delivered", "cancelled"] as const;
export type HardwareStage = (typeof STAGES)[number];
export type DeliveryMethod = "tech_setup" | "user_setup";

export interface HardwareOrderView {
  stage: HardwareStage;
  /** Staff only. */
  vendor: string | null;
  /** Staff only. */
  orderRef: string | null;
  expectedOn: string | null;
  orderedAt: string | null;
  orderedByName: string | null;
  receivedAt: string | null;
  receivedByName: string | null;
  deliveryMethod: DeliveryMethod | null;
  deliveredAt: string | null;
  deliveredByName: string | null;
  /** What was received. The asset link is only for people who can see the asset register. */
  items: { label: string; assetId: string | null }[];
  canAct: boolean;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const dateOnly = (v: unknown) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);

export async function hardwareFor(tx: Queryable, p: Principal, ticketId: string, customerId: string): Promise<HardwareOrderView | null> {
  const r = await tx.query<Record<string, unknown>>(
    `select h.*, ob.display_name as ordered_by_name, rb.display_name as received_by_name, db.display_name as delivered_by_name
       from hardware_orders h
       left join users ob on ob.id = h.ordered_by left join users rb on rb.id = h.received_by left join users db on db.id = h.delivered_by
      where h.ticket_id = $1`,
    [ticketId],
  );
  const h = r.rows[0];
  if (!h) return null;
  const staff = isStaffFor(p, customerId);
  const items = await tx.query<{ label: string; asset_id: string }>("select label, asset_id from ticket_assets where ticket_id = $1 order by linked_at, label", [ticketId]);
  const org = canSeeOrgFor(p, customerId);
  return {
    stage: h.stage as HardwareStage,
    vendor: staff ? ((h.vendor as string) ?? null) : null,
    orderRef: staff ? ((h.order_ref as string) ?? null) : null,
    expectedOn: dateOnly(h.expected_on),
    orderedAt: iso(h.ordered_at),
    orderedByName: (h.ordered_by_name as string) ?? null,
    receivedAt: iso(h.received_at),
    receivedByName: (h.received_by_name as string) ?? null,
    deliveryMethod: (h.delivery_method as DeliveryMethod) ?? null,
    deliveredAt: iso(h.delivered_at),
    deliveredByName: (h.delivered_by_name as string) ?? null,
    items: items.rows.map((i) => ({ label: i.label, assetId: org ? i.asset_id : null })),
    canAct: staff,
  };
}
