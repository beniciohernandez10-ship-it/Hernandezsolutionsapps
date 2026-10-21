import { z } from "zod";
import type { Database } from "../db";

/**
 * One-time bootstrap of an environment: the Hernandez Solutions home
 * directory and the first platform operator, bound to their Entra (tenant,
 * object) identity. Runs from the production deploy step only when the
 * BOOTSTRAP_* variables are set, and does nothing once any operator exists,
 * so it can never be used to add a second administrator or take over one.
 */
export const bootstrapSchema = z.object({
  tenantId: z.uuid(),
  tenantName: z.string().trim().min(1).max(200),
  objectId: z.uuid(),
  email: z.email().max(320),
  displayName: z.string().trim().min(1).max(200),
});
export type BootstrapInput = z.infer<typeof bootstrapSchema>;

export function bootstrapFromEnv(env: Record<string, string | undefined>): BootstrapInput | null {
  if (!env.BOOTSTRAP_HS_TENANT_ID && !env.BOOTSTRAP_OPERATOR_OBJECT_ID) return null;
  return bootstrapSchema.parse({
    tenantId: env.BOOTSTRAP_HS_TENANT_ID,
    tenantName: env.BOOTSTRAP_HS_TENANT_NAME ?? "Hernandez Solutions",
    objectId: env.BOOTSTRAP_OPERATOR_OBJECT_ID,
    email: env.BOOTSTRAP_OPERATOR_EMAIL,
    displayName: env.BOOTSTRAP_OPERATOR_NAME,
  });
}

export async function bootstrapOperator(database: Database, input: BootstrapInput): Promise<"created" | "skipped"> {
  return database.transaction(async (tx) => {
    const existing = await tx.query("select 1 from users where is_platform_operator and status = 'active' and not is_demo limit 1");
    if (existing.rows.length) return "skipped";
    await tx.query(
      `insert into entra_directories (tenant_id, display_name, kind) values ($1, $2, 'msp')
       on conflict (tenant_id) do update set kind = 'msp', sign_in_enabled = true`,
      [input.tenantId, input.tenantName],
    );
    const u = await tx.query<{ id: string }>(
      "insert into users (email, display_name, is_platform_operator) values ($1, $2, true) returning id",
      [input.email.toLowerCase(), input.displayName],
    );
    await tx.query("insert into user_identities (user_id, tenant_id, object_id) values ($1, $2, $3)", [u.rows[0].id, input.tenantId, input.objectId]);
    await tx.query(
      "insert into audit_events (actor_user_id, action, target_type, target_id, details) values (null, 'platform.bootstrap_operator', 'user', $1, $2)",
      [u.rows[0].id, JSON.stringify({ tenantId: input.tenantId })],
    );
    return "created";
  });
}

/**
 * Optional second bootstrap step: an internal customer for Hernandez
 * Solutions itself, with the (single) platform operator from the home
 * directory as its service manager, so the operator can use the service desk.
 * Idempotent: an existing customer or membership is left as it is.
 */
export async function bootstrapHomeCustomer(database: Database, name: string): Promise<"created" | "exists" | "skipped"> {
  const clean = z.string().trim().min(1).max(200).parse(name);
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 63) || "home";
  return database.transaction(async (tx) => {
    const ops = await tx.query<{ id: string }>(
      `select distinct u.id from users u join user_identities i on i.user_id = u.id
         join entra_directories d on d.tenant_id = i.tenant_id and d.kind = 'msp'
        where u.is_platform_operator and u.status = 'active' and not u.is_demo`,
    );
    if (ops.rows.length !== 1) return "skipped";
    const operator = ops.rows[0].id;
    const c = await tx.query<{ id: string }>("insert into customers (name, slug) values ($1, $2) on conflict (slug) do nothing returning id", [clean, slug]);
    const customerId = c.rows[0]?.id ?? (await tx.query<{ id: string }>("select id from customers where slug = $1", [slug])).rows[0].id;
    const m = await tx.query(
      `insert into memberships (user_id, customer_id, role, granted_by) values ($1, $2, 'service_manager', $1)
       on conflict (user_id, customer_id) where revoked_at is null do nothing`,
      [operator, customerId],
    );
    if (!c.rows[0] && !m.rowCount) return "exists";
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values (null, $1, 'platform.bootstrap_home_customer', 'customer', $2, $3)",
      [customerId, customerId, JSON.stringify({ serviceManager: operator })],
    );
    return "created";
  });
}
