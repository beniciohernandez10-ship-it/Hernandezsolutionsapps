import { z } from "zod";
import { asSystem } from "../db";
import { requireOperator, type Principal } from "../authz";
import { AppError, notFound } from "../errors";
import { policyFromRow, slaPolicySchema, type SlaPolicy } from "./service";

/**
 * Operator management of SLA policies. New tickets use the current policy.
 * Open tickets keep the due times they were given until their clock next
 * changes (paused, resumed or re-prioritised), when they are recomputed from
 * the policy as it is then.
 */

export async function listSlaPolicies(p: Principal): Promise<(SlaPolicy & { customers: { id: string; name: string }[] })[]> {
  requireOperator(p);
  return asSystem(async (tx) => {
    const r = await tx.query("select * from sla_policies order by name");
    const c = await tx.query<{ id: string; name: string; sla_policy_id: string }>(
      "select id, name, sla_policy_id from customers where sla_policy_id is not null order by name",
    );
    return r.rows.map((row) => {
      const policy = policyFromRow(row);
      return { ...policy, customers: c.rows.filter((x) => x.sla_policy_id === policy.id).map((x) => ({ id: x.id, name: x.name })) };
    });
  });
}

async function audit(p: Principal, action: string, targetType: string, targetId: string, customerId: string | null, details: object) {
  await asSystem((tx) =>
    tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, $3, $4, $5, $6)",
      [p.userId, customerId, action, targetType, targetId, JSON.stringify(details)],
    ),
  );
}

export async function saveSlaPolicy(p: Principal, id: string | null, raw: unknown) {
  requireOperator(p);
  const v = slaPolicySchema.parse(raw);
  const params = [v.name, v.timeZone, JSON.stringify(v.hours), v.holidays, JSON.stringify(v.targets), v.warnPercent];
  const saved = await asSystem(async (tx) => {
    const r = id
      ? await tx.query<{ id: string }>(
          `update sla_policies set name = $2, time_zone = $3, business_hours = $4, holidays = $5::date[], targets = $6, warn_percent = $7, updated_at = now()
            where id = $1 returning id`,
          [id, ...params],
        )
      : await tx.query<{ id: string }>(
          `insert into sla_policies (name, time_zone, business_hours, holidays, targets, warn_percent)
           values ($1, $2, $3, $4::date[], $5, $6) on conflict (name) do nothing returning id`,
          params,
        );
    return r.rows[0];
  }).catch((err) => {
    if ((err as { code?: string }).code === "23505") throw new AppError(409, "validation_failed", "A policy with that name already exists.", { field: "name" });
    throw err;
  });
  if (!saved) throw id ? notFound("Policy") : new AppError(409, "validation_failed", "A policy with that name already exists.", { field: "name" });
  await audit(p, id ? "sla.policy_update" : "sla.policy_create", "sla_policy", saved.id, null, { name: v.name });
  return { id: saved.id };
}

export const assignSchema = z.object({ policyId: z.uuid().nullable() });

export async function assignSlaPolicy(p: Principal, customerId: string, raw: unknown) {
  requireOperator(p);
  const { policyId } = assignSchema.parse(raw);
  const r = await asSystem(async (tx) => {
    if (policyId && !(await tx.query("select 1 from sla_policies where id = $1", [policyId])).rows[0]) throw notFound("Policy");
    return tx.query("update customers set sla_policy_id = $2, updated_at = now() where id = $1", [customerId, policyId]);
  });
  if (!r.rowCount) throw notFound("Customer");
  await audit(p, "sla.assign", "customer", customerId, customerId, { policyId });
  return { ok: true };
}
