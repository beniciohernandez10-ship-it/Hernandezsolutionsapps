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
