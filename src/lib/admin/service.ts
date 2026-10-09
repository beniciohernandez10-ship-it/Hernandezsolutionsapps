import { z } from "zod";
import { asSystem, type Queryable } from "../db";
import { requireOperator, type Principal } from "../authz";
import { AppError, notFound } from "../errors";
import { config } from "../config";
import { randomToken, sha256 } from "../auth/crypto";
import { revokeAllSessionsForUser } from "../auth/session";

/**
 * Platform-operator administration: customer onboarding, provider mappings and
 * membership management. These are explicit administrative workflows; nothing
 * here runs implicitly during request initialisation. Operators manage the
 * platform but do not gain ticket visibility unless separately assigned.
 */

async function audit(tx: Queryable, p: Principal, action: string, customerId: string | null, targetType: string, targetId: string, details = {}) {
  await tx.query(
    "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, $3, $4, $5, $6)",
    [p.userId, customerId, action, targetType, targetId, JSON.stringify(details)],
  );
}

export async function listCustomersForOperator(p: Principal) {
  requireOperator(p);
  return asSystem(async (tx) => {
    const c = await tx.query(
      `select c.id, c.slug, c.name, c.status, c.is_demo,
              (select count(*) from memberships m where m.customer_id = c.id and m.revoked_at is null)::int as members,
              (select json_agg(json_build_object('tenantId', d.tenant_id, 'name', d.display_name, 'inventory', ced.inventory_enabled, 'consentAt', d.inventory_consent_at))
                 from customer_entra_directories ced join entra_directories d on d.id = ced.directory_id where ced.customer_id = c.id) as directories,
              (select json_agg(json_build_object('connection', ac.name, 'ateraCustomerId', cam.atera_customer_id, 'verifiedAt', cam.verified_at))
                 from customer_atera_mappings cam join atera_connections ac on ac.id = cam.connection_id where cam.customer_id = c.id) as atera
         from customers c order by c.name`,
    );
    return c.rows;
  });
}

export async function listMembershipsForOperator(p: Principal, customerId: string) {
  requireOperator(p);
  return asSystem(async (tx) => {
    const r = await tx.query(
      `select m.id, m.role, m.created_at, u.id as user_id, u.display_name, u.email, u.status,
              (select count(*) from user_identities i where i.user_id = u.id)::int as identities
         from memberships m join users u on u.id = m.user_id
        where m.customer_id = $1 and m.revoked_at is null order by m.role, u.display_name`,
      [customerId],
    );
    return r.rows;
  });
}

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, { error: "Use lowercase letters, numbers and dashes." }),
});

export async function createCustomer(p: Principal, raw: unknown) {
  requireOperator(p);
  const input = createCustomerSchema.parse(raw);
  return asSystem(async (tx) => {
    const r = await tx.query<{ id: string }>(
      "insert into customers (name, slug) values ($1, $2) on conflict (slug) do nothing returning id",
      [input.name, input.slug],
    );
    if (!r.rows[0]) throw new AppError(409, "validation_failed", "That slug is already in use.", { field: "slug" });
    await audit(tx, p, "customer.create", r.rows[0].id, "customer", r.rows[0].id, { slug: input.slug });
    return { id: r.rows[0].id };
  });
}

export const directorySchema = z.object({
  tenantId: z.uuid(),
  displayName: z.string().trim().min(1).max(200),
  inventoryEnabled: z.boolean().default(false),
});

/** Maps a customer Entra directory (tenant ID) to an internal customer. */
export async function mapDirectory(p: Principal, customerId: string, raw: unknown) {
  requireOperator(p);
  const input = directorySchema.parse(raw);
  const tid = input.tenantId.toLowerCase();
  return asSystem(async (tx) => {
    await requireCustomer(tx, customerId);
    const existing = await tx.query<{ id: string; kind: string; customer_id: string | null }>(
      `select d.id, d.kind, ced.customer_id from entra_directories d
         left join customer_entra_directories ced on ced.directory_id = d.id where d.tenant_id = $1`,
      [tid],
    );
    let directoryId = existing.rows[0]?.id;
    if (existing.rows[0]?.kind === "msp") throw new AppError(422, "validation_failed", "That is the MSP home directory.");
    if (existing.rows[0]?.customer_id && existing.rows[0].customer_id !== customerId) {
      throw new AppError(409, "validation_failed", "That directory is already mapped to another customer.");
    }
    if (!directoryId) {
      const d = await tx.query<{ id: string }>(
        "insert into entra_directories (tenant_id, display_name, kind) values ($1, $2, 'customer') returning id",
        [tid, input.displayName],
      );
      directoryId = d.rows[0].id;
    }
    await tx.query(
      `insert into customer_entra_directories (customer_id, directory_id, inventory_enabled) values ($1, $2, $3)
       on conflict (customer_id, directory_id) do update set inventory_enabled = excluded.inventory_enabled`,
      [customerId, directoryId, input.inventoryEnabled],
    );
    await audit(tx, p, "customer.directory_map", customerId, "entra_directory", tid, { inventoryEnabled: input.inventoryEnabled });
    return { directoryId };
  });
}

export const ateraMappingSchema = z.object({
  connectionId: z.uuid(),
  ateraCustomerId: z.coerce.number().int().positive(),
});

export async function mapAteraCustomer(p: Principal, customerId: string, raw: unknown) {
  requireOperator(p);
  const input = ateraMappingSchema.parse(raw);
  return asSystem(async (tx) => {
    await requireCustomer(tx, customerId);
    const taken = await tx.query<{ customer_id: string }>(
      "select customer_id from customer_atera_mappings where connection_id = $1 and atera_customer_id = $2",
      [input.connectionId, input.ateraCustomerId],
    );
    if (taken.rows[0] && taken.rows[0].customer_id !== customerId) {
      throw new AppError(409, "validation_failed", "That Atera customer is already mapped to another customer.");
    }
    await tx.query(
      `insert into customer_atera_mappings (customer_id, connection_id, atera_customer_id) values ($1, $2, $3)
       on conflict (customer_id, connection_id) do update set atera_customer_id = excluded.atera_customer_id, verified_at = null, verified_name = null`,
      [customerId, input.connectionId, input.ateraCustomerId],
    );
    // Mapping must be verified by a read-only lookup before any import uses it.
    await tx.query(
      `insert into jobs (kind, customer_id, payload, dedupe_key) values ('atera.verify_mapping', $1, $2, $3)
       on conflict (dedupe_key) do update set status = 'queued', attempts = 0, run_after = now()`,
      [customerId, JSON.stringify({ connectionId: input.connectionId }), `atera.verify_mapping:${customerId}:${input.connectionId}`],
    );
    await audit(tx, p, "customer.atera_map", customerId, "atera_customer", String(input.ateraCustomerId), { connectionId: input.connectionId });
    return { ok: true };
  });
}

export const membershipSchema = z.object({
  email: z.email().max(320),
  displayName: z.string().trim().min(1).max(200),
  role: z.enum(["requester", "client_admin", "technician", "service_manager"]),
  /** Directory the person signs in from (customer tenant, or the MSP tenant for staff). */
  tenantId: z.uuid(),
});

/**
 * Grants a role. If the person has never signed in, creates the user and an
 * invitation bound to their directory. Returns a one-time invitation link the
 * operator delivers out-of-band. Email is used for display/contact only.
 */
export async function grantMembership(p: Principal, customerId: string, raw: unknown) {
  requireOperator(p);
  const input = membershipSchema.parse(raw);
  const tid = input.tenantId.toLowerCase();
  return asSystem(async (tx) => {
    await requireCustomer(tx, customerId);
    const dir = await tx.query<{ kind: string; customer_id: string | null }>(
      `select d.kind, ced.customer_id from entra_directories d
         left join customer_entra_directories ced on ced.directory_id = d.id
        where d.tenant_id = $1 and d.sign_in_enabled`,
      [tid],
    );
    const staffRole = input.role === "technician" || input.role === "service_manager";
    const d = dir.rows[0];
    if (!d) throw new AppError(422, "validation_failed", "Map that directory before inviting people from it.", { field: "tenantId" });
    if (!staffRole && d.customer_id !== customerId) {
      throw new AppError(422, "validation_failed", "Customer roles must come from a directory mapped to this customer.", { field: "tenantId" });
    }
    if (staffRole && d.kind !== "msp") {
      throw new AppError(422, "validation_failed", "Technicians and service managers must sign in from the Hernandez Solutions directory.", { field: "tenantId" });
    }

    // Reuse a user only if they already have an identity in that directory with this email on record.
    const existing = await tx.query<{ id: string }>(
      `select u.id from users u join user_identities i on i.user_id = u.id
        where lower(u.email) = lower($1) and i.tenant_id = $2 limit 1`,
      [input.email, tid],
    );
    let userId = existing.rows[0]?.id;
    let invitation: { url: string; expiresAt: string } | null = null;
    if (!userId) {
      const pending = await tx.query<{ id: string }>(
        `select u.id from users u join invitations inv on inv.user_id = u.id
          where lower(u.email) = lower($1) and inv.tenant_id = $2 and inv.accepted_at is null limit 1`,
        [input.email, tid],
      );
      userId = pending.rows[0]?.id;
      if (!userId) {
        const u = await tx.query<{ id: string }>("insert into users (email, display_name) values ($1, $2) returning id", [
          input.email,
          input.displayName,
        ]);
        userId = u.rows[0].id;
      }
      const token = randomToken(32);
      const expiresAt = new Date(Date.now() + 7 * 86400_000);
      await tx.query(
        "insert into invitations (token_hash, user_id, tenant_id, created_by, expires_at) values ($1, $2, $3, $4, $5)",
        [sha256(token), userId, tid, p.userId, expiresAt],
      );
      invitation = { url: `${config().appOrigin}/api/auth/signin?invite=${encodeURIComponent(token)}`, expiresAt: expiresAt.toISOString() };
    }
    const active = await tx.query("select 1 from memberships where user_id = $1 and customer_id = $2 and revoked_at is null", [userId, customerId]);
    if (active.rows[0]) throw new AppError(409, "validation_failed", "That person already has a role for this customer. Revoke it first to change it.");
    const m = await tx.query<{ id: string }>(
      "insert into memberships (user_id, customer_id, role, granted_by) values ($1, $2, $3, $4) returning id",
      [userId, customerId, input.role, p.userId],
    );
    await audit(tx, p, "membership.grant", customerId, "membership", m.rows[0].id, { role: input.role, userId });
    return { membershipId: m.rows[0].id, userId, invitation };
  });
}

export async function revokeMembership(p: Principal, membershipId: string) {
  requireOperator(p);
  const result = await asSystem(async (tx) => {
    const r = await tx.query<{ customer_id: string; user_id: string }>(
      "update memberships set revoked_at = now(), revoked_by = $2 where id = $1 and revoked_at is null returning customer_id, user_id",
      [membershipId, p.userId],
    );
    if (!r.rows[0]) throw notFound("Membership");
    await audit(tx, p, "membership.revoke", r.rows[0].customer_id, "membership", membershipId, { userId: r.rows[0].user_id });
    const remaining = await tx.query("select 1 from memberships where user_id = $1 and revoked_at is null", [r.rows[0].user_id]);
    return { userId: r.rows[0].user_id, hasOther: remaining.rows.length > 0 };
  });
  // Access is re-evaluated on every request; sessions with no remaining access are also ended.
  if (!result.hasOther) await revokeAllSessionsForUser(result.userId);
  return { ok: true };
}

export const customerStatusSchema = z.object({ status: z.enum(["active", "offboarding", "offboarded"]) });

/** Offboarding: 'offboarded' immediately removes portal access for every member of the customer. */
export async function setCustomerStatus(p: Principal, customerId: string, raw: unknown) {
  requireOperator(p);
  const { status } = customerStatusSchema.parse(raw);
  return asSystem(async (tx) => {
    const r = await tx.query("update customers set status = $2, updated_at = now() where id = $1 returning id", [customerId, status]);
    if (!r.rows[0]) throw notFound("Customer");
    if (status === "offboarded") {
      await tx.query("update customer_entra_directories set inventory_enabled = false where customer_id = $1", [customerId]);
    }
    await audit(tx, p, "customer.status", customerId, "customer", customerId, { status });
    return { ok: true };
  });
}

export async function listAteraConnections(p: Principal) {
  requireOperator(p);
  return asSystem(async (tx) => (await tx.query("select id, name, api_key_env_var, enabled from atera_connections order by name")).rows);
}

async function requireCustomer(tx: Queryable, customerId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) throw notFound("Customer");
  const c = await tx.query("select 1 from customers where id = $1", [customerId]);
  if (!c.rows[0]) throw notFound("Customer");
}
