import { randomBytes } from "node:crypto";
import { asSystem, withUser, type Queryable } from "../db";
import { canSeeOrgFor, customersWhere, isStaffFor, ORG_ROLES, requireStaff, STAFF_ROLES, type Principal } from "../authz";
import { AppError, forbidden, notFound } from "../errors";
import { config } from "../config";
import { log, errorSummary } from "../log";
import { getDirectoryUser, searchDirectoryUsers } from "../integrations/graph";
import { ProviderError } from "../integrations/http";
import { formatAssetTag, newShortCode, type AssetKind } from "./naming";
import { directorySearchSchema, registerAssetSchema, updateAssetSchema } from "./schemas";
import type { z } from "zod";

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
/** A DATE column as YYYY-MM-DD (drivers return Date objects or strings). */
const dateOnly = (v: unknown) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);

const HW_COLUMNS = [
  ["manufacturer", "manufacturer"],
  ["model", "model"],
  ["serialNumber", "serial_number"],
  ["purchaseDate", "purchase_date"],
  ["warrantyExpires", "warranty_expires"],
] as const;

export interface AssetSummary {
  id: string;
  customerId: string;
  customerName: string;
  kind: AssetKind;
  tag: string;
  shortCode: string;
  status: "active" | "retired";
  primaryUserName: string | null;
  primaryUserUpn: string | null;
  primaryUserSource: "none" | "directory" | "portal";
  location: string | null;
  updatedAt: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  purchaseDate: string | null;
  warrantyExpires: string | null;
  /** Provider device (Intune/Atera) currently reporting this name, if any. */
  linkedDevice: { id: string; source: string; complianceState: string | null; lastSyncAt: string | null } | null;
}

export interface AssetDetail extends AssetSummary {
  notes: string | null;
  version: number;
  createdAt: string;
  createdByName: string | null;
  qrUrl: string;
  canEdit: boolean;
  history: { at: string; action: string; actorName: string | null; details: Record<string, unknown> }[];
  /** Requests this hardware arrived through (hardware orders). */
  requests: { ticketId: string; number: number; title: string }[];
}

const SELECT = `
  select a.*, c.name as customer_name, d.id as device_id, d.source as device_source,
         d.compliance_state as device_compliance, d.last_provider_sync_at as device_sync
    from assets a
    join customers c on c.id = a.customer_id
    left join lateral (
      select id, source, compliance_state, last_provider_sync_at from devices
       where customer_id = a.customer_id and removed_at is null and upper(name) = a.tag
       order by last_provider_sync_at desc nulls last limit 1
    ) d on true`;

function toSummary(r: Record<string, unknown>): AssetSummary {
  return {
    id: r.id as string,
    customerId: r.customer_id as string,
    customerName: r.customer_name as string,
    kind: r.kind as AssetKind,
    tag: r.tag as string,
    shortCode: r.short_code as string,
    status: r.status as "active" | "retired",
    primaryUserName: (r.primary_user_name as string) ?? null,
    primaryUserUpn: (r.primary_user_upn as string) ?? null,
    primaryUserSource: r.primary_user_source as AssetSummary["primaryUserSource"],
    location: (r.location as string) || null,
    updatedAt: iso(r.updated_at)!,
    manufacturer: (r.manufacturer as string) || null,
    model: (r.model as string) || null,
    serialNumber: (r.serial_number as string) || null,
    purchaseDate: dateOnly(r.purchase_date),
    warrantyExpires: dateOnly(r.warranty_expires),
    linkedDevice: r.device_id
      ? {
          id: r.device_id as string,
          source: r.device_source as string,
          complianceState: (r.device_compliance as string) ?? null,
          lastSyncAt: iso(r.device_sync),
        }
      : null,
  };
}

export const assetQrUrl = (shortCode: string) => `${config().appOrigin}/a/${shortCode}`;

export async function listAssets(p: Principal, opts: { includeRetired?: boolean } = {}) {
  const targets = customersWhere(p, (r) => ORG_ROLES.includes(r));
  if (targets.length === 0) throw forbidden("You cannot view this organization's devices.");
  return withUser(p.userId, async (tx) => {
    const res = await tx.query(
      `${SELECT} where a.customer_id = any($1::uuid[]) ${opts.includeRetired ? "" : "and a.status = 'active'"}
       order by c.name, a.kind, a.number`,
      [targets],
    );
    return res.rows.map(toSummary);
  });
}

export async function getAsset(p: Principal, id: string): Promise<AssetDetail> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Device");
  return withUser(p.userId, async (tx) => {
    const res = await tx.query(`${SELECT} where a.id = $1`, [id]);
    const r = res.rows[0];
    // RLS hides other customers' assets; the explicit check keeps the rule visible here too.
    if (!r || !canSeeOrgFor(p, r.customer_id as string)) throw notFound("Device");
    const hist = await tx.query(
      `select e.at, e.action, e.details, u.display_name from asset_events e left join users u on u.id = e.actor_user_id
        where e.asset_id = $1 order by e.at desc, e.id desc limit 100`,
      [id],
    );
    const reqs = await tx.query<{ id: string; number: string; title: string }>(
      "select t.id, t.number, t.title from ticket_assets ta join tickets t on t.id = ta.ticket_id where ta.asset_id = $1 order by ta.linked_at",
      [id],
    );
    const creator = r.created_by
      ? await tx.query<{ display_name: string }>("select display_name from users where id = $1", [r.created_by])
      : null;
    return {
      ...toSummary(r),
      notes: (r.notes as string) || null,
      version: Number(r.version),
      createdAt: iso(r.created_at)!,
      createdByName: creator?.rows[0]?.display_name ?? null,
      qrUrl: assetQrUrl(r.short_code as string),
      canEdit: isStaffFor(p, r.customer_id as string),
      history: hist.rows.map((h) => ({
        at: iso(h.at)!,
        action: h.action as string,
        actorName: (h.display_name as string) ?? null,
        details: (typeof h.details === "string" ? JSON.parse(h.details) : h.details) as Record<string, unknown>,
      })),
      requests: reqs.rows.map((x) => ({ ticketId: x.id, number: Number(x.number), title: x.title })),
    };
  });
}

/** Resolves a printed QR short code to the asset, applying the same visibility rules. */
export async function resolveShortCode(p: Principal, code: string) {
  if (!/^[a-z2-9]{10}$/.test(code)) throw notFound("Device");
  return withUser(p.userId, async (tx) => {
    const r = await tx.query<{ id: string; customer_id: string }>("select id, customer_id from assets where short_code = $1", [code]);
    if (!r.rows[0] || !canSeeOrgFor(p, r.rows[0].customer_id)) throw notFound("Device");
    return r.rows[0].id;
  });
}

// ---------------------------------------------------------------- primary user

type PrimaryUserInput = z.infer<typeof registerAssetSchema>["primaryUser"];
export interface ResolvedUser {
  source: "none" | "directory" | "portal";
  tenantId: string | null;
  objectId: string | null;
  portalUserId: string | null;
  name: string | null;
  upn: string | null;
}

async function consentedTenants(customerId: string) {
  const r = await asSystem((tx) =>
    tx.query<{ tenant_id: string }>(
      `select d.tenant_id from customer_entra_directories ced join entra_directories d on d.id = ced.directory_id
        where ced.customer_id = $1 and d.inventory_consent_at is not null`,
      [customerId],
    ),
  );
  return r.rows.map((x) => x.tenant_id.toLowerCase());
}

function graphConfigured() {
  return Boolean(config().graph.clientId && config().graph.clientSecret);
}

/**
 * Never trusts a name or UPN sent by the browser: directory users are re-read
 * from the customer's own Entra directory, portal users must hold an active
 * membership in the same customer. Runs before the write transaction so no
 * network call happens while rows are locked. Callers check staff access first.
 */
async function resolvePrimaryUser(customerId: string, input: PrimaryUserInput): Promise<ResolvedUser> {
  if (input.source === "none") return { source: "none", tenantId: null, objectId: null, portalUserId: null, name: null, upn: null };
  if (input.source === "portal") {
    const r = await asSystem((tx) =>
      tx.query<{ display_name: string; email: string }>(
        `select u.display_name, u.email from users u join memberships m on m.user_id = u.id
          where u.id = $1 and m.customer_id = $2 and m.revoked_at is null and u.status = 'active'`,
        [input.userId, customerId],
      ),
    );
    if (!r.rows[0]) throw new AppError(422, "validation_failed", "That person is not a member of this organization.");
    return { source: "portal", tenantId: null, objectId: null, portalUserId: input.userId, name: r.rows[0].display_name, upn: r.rows[0].email };
  }
  const tenantId = input.tenantId.toLowerCase();
  if (!(await consentedTenants(customerId)).includes(tenantId)) {
    throw new AppError(422, "validation_failed", "That directory is not connected to this organization.");
  }
  let user;
  try {
    user = await getDirectoryUser(tenantId, input.objectId);
  } catch (err) {
    log.warn("assets.directory_lookup_failed", { customerId, error: errorSummary(err) });
    throw new AppError(502 as number, "internal", "Microsoft Entra ID could not be reached. Try again shortly.");
  }
  if (!user) throw new AppError(422, "validation_failed", "That user was not found in the organization's directory.");
  return { source: "directory", tenantId, objectId: user.objectId, portalUserId: null, name: user.displayName, upn: user.userPrincipalName };
}

export interface DirectorySearchResult {
  source: "directory" | "portal";
  /** Why directory search is unavailable, shown to staff. */
  notice: string | null;
  users: { key: string; name: string; upn: string; ref: PrimaryUserInput }[];
}

export async function searchPrimaryUsers(p: Principal, raw: unknown): Promise<DirectorySearchResult> {
  const { customerId, q } = directorySearchSchema.parse(raw);
  requireStaff(p, customerId);
  const tenants = graphConfigured() ? await consentedTenants(customerId) : [];
  if (tenants.length > 0) {
    try {
      const results = await Promise.all(tenants.map((t) => searchDirectoryUsers(t, q).then((us) => us.map((u) => ({ u, t })))));
      return {
        source: "directory",
        notice: null,
        users: results.flat().slice(0, 20).map(({ u, t }) => ({
          key: `${t}:${u.objectId}`,
          name: u.displayName,
          upn: u.userPrincipalName,
          ref: { source: "directory", tenantId: t, objectId: u.objectId },
        })),
      };
    } catch (err) {
      log.warn("assets.directory_search_failed", { customerId, error: errorSummary(err) });
      const msg = err instanceof ProviderError ? err.message : "Directory search failed.";
      return { source: "directory", notice: msg, users: [] };
    }
  }
  // Fallback: people who already have portal access for this organization.
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const r = await withUser(p.userId, (tx) =>
    tx.query<{ id: string; display_name: string; email: string }>(
      `select distinct u.id, u.display_name, u.email from users u join memberships m on m.user_id = u.id
        where m.customer_id = $1 and m.revoked_at is null and u.status = 'active'
          and (u.display_name ilike $2 or u.email ilike $2) order by u.display_name limit 20`,
      [customerId, like],
    ),
  );
  return {
    source: "portal",
    notice: graphConfigured()
      ? "This organization has not approved directory access yet, so only people with portal access are listed."
      : "Microsoft directory search is not configured, so only people with portal access are listed.",
    users: r.rows.map((u) => ({ key: u.id, name: u.display_name, upn: u.email, ref: { source: "portal", userId: u.id } })),
  };
}

// ---------------------------------------------------------------- writes

async function event(tx: Queryable, p: Principal, assetId: string, customerId: string, action: string, details: Record<string, unknown>) {
  await tx.query("insert into asset_events (asset_id, customer_id, actor_user_id, action, details) values ($1, $2, $3, $4, $5)", [
    assetId,
    customerId,
    p.userId,
    action,
    JSON.stringify(details),
  ]);
  await tx.query(
    "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, $3, 'asset', $4, $5)",
    [p.userId, customerId, `asset.${action}`, assetId, JSON.stringify(details)],
  );
}

export async function registerAsset(p: Principal, raw: unknown) {
  const input = registerAssetSchema.parse(raw);
  requireStaff(p, input.customerId);
  const user = await resolvePrimaryUser(input.customerId, input.primaryUser);
  return withUser(p.userId, (tx) => insertAsset(tx, p, input, user));
}

/** A portal member as an asset's primary user, or nobody if they're no longer a member. */
export async function portalPrimaryUser(customerId: string, userId: string): Promise<ResolvedUser> {
  try {
    return await resolvePrimaryUser(customerId, { source: "portal", userId });
  } catch (err) {
    if (err instanceof AppError && err.status === 422) return resolvePrimaryUser(customerId, { source: "none" });
    throw err;
  }
}

/**
 * Registers one asset in the caller's (staff) transaction: allocates the next
 * tag for its kind and records the "registered" event. Used by registerAsset
 * and by hardware receiving.
 */
export async function insertAsset(
  tx: Queryable,
  p: Principal,
  input: z.infer<typeof registerAssetSchema>,
  user: ResolvedUser,
  eventDetails: Record<string, unknown> = {},
) {
  const active = await tx.query("select 1 from customers where id = $1 and status = 'active'", [input.customerId]);
  if (!active.rows[0]) throw forbidden("Devices can only be registered for active organizations.");
  const n = Number(
    (await tx.query<{ n: number }>("select app_next_asset_number($1, $2) as n", [input.customerId, input.kind])).rows[0].n,
  );
  const tag = formatAssetTag(input.kind, n);
  const shortCode = newShortCode((k) => randomBytes(k));
  const ins = await tx.query<{ id: string }>(
    `insert into assets (customer_id, kind, number, tag, short_code, primary_user_source, primary_user_tenant_id,
                         primary_user_object_id, primary_user_portal_id, primary_user_name, primary_user_upn,
                         location, notes, created_by, manufacturer, model, serial_number, purchase_date, warranty_expires)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, nullif($12, ''), nullif($13, ''), $14,
             nullif($15, ''), nullif($16, ''), nullif($17, ''), nullif($18, '')::date, nullif($19, '')::date) returning id`,
    [
      input.customerId, input.kind, n, tag, shortCode, user.source, user.tenantId, user.objectId, user.portalUserId,
      user.name, user.upn, input.location, input.notes, p.userId,
      input.hardware?.manufacturer ?? "", input.hardware?.model ?? "", input.hardware?.serialNumber ?? "",
      input.hardware?.purchaseDate ?? "", input.hardware?.warrantyExpires ?? "",
    ],
  );
  const id = ins.rows[0].id;
  await event(tx, p, id, input.customerId, "registered", { tag, primaryUser: user.name, location: input.location || null, ...eventDetails });
  return { id, tag };
}

export async function updateAsset(p: Principal, id: string, raw: unknown) {
  const input = updateAssetSchema.parse(raw);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Device");
  // Authorization first, on a plain read: client admins can see the device but get a clear 403.
  const owner = await withUser(p.userId, (tx) => tx.query<{ customer_id: string }>("select customer_id from assets where id = $1", [id]));
  const cust = owner.rows[0]?.customer_id;
  if (!cust || !canSeeOrgFor(p, cust)) throw notFound("Device");
  if (!isStaffFor(p, cust)) throw forbidden("Only Hernandez Solutions technicians can change registered devices.");
  const newUser = input.primaryUser ? await resolvePrimaryUser(cust, input.primaryUser) : undefined;
  return withUser(p.userId, async (tx) => {
    const cur = (await tx.query("select * from assets where id = $1 for update", [id])).rows[0];
    if (!cur || cur.customer_id !== cust) throw notFound("Device");
    const customerId = cust;
    if (Number(cur.version) !== input.version) {
      throw new AppError(409, "version_conflict", "Someone else changed this device. Reload to see the latest details.");
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (newUser) {
      const u = newUser;
      const changed = u.source !== cur.primary_user_source || u.objectId !== cur.primary_user_object_id || u.portalUserId !== cur.primary_user_portal_id;
      if (changed) {
        set("primary_user_source", u.source);
        set("primary_user_tenant_id", u.tenantId);
        set("primary_user_object_id", u.objectId);
        set("primary_user_portal_id", u.portalUserId);
        set("primary_user_name", u.name);
        set("primary_user_upn", u.upn);
        await event(tx, p, id, customerId, "user_changed", { from: cur.primary_user_name ?? null, to: u.name });
      }
    }
    if (input.location !== undefined && (input.location || null) !== (cur.location ?? null)) {
      set("location", input.location || null);
      await event(tx, p, id, customerId, "location_changed", { from: cur.location ?? null, to: input.location || null });
    }
    if (input.notes !== undefined && (input.notes || null) !== (cur.notes ?? null)) {
      set("notes", input.notes || null);
      await event(tx, p, id, customerId, "notes_changed", {});
    }
    if (input.hardware) {
      const changed: string[] = [];
      for (const [key, col] of HW_COLUMNS) {
        const v = input.hardware[key];
        if (v === undefined) continue;
        const next = v || null;
        const prev = col === "purchase_date" || col === "warranty_expires" ? dateOnly(cur[col]) : ((cur[col] as string) ?? null);
        if (next !== prev) {
          set(col, next);
          changed.push(key);
        }
      }
      if (changed.length) await event(tx, p, id, customerId, "hardware_changed", { fields: changed });
    }
    if (input.status && input.status !== cur.status) {
      set("status", input.status);
      set("retired_at", input.status === "retired" ? new Date().toISOString() : null);
      await event(tx, p, id, customerId, input.status === "retired" ? "retired" : "reactivated", {});
    }
    if (sets.length === 0) return { ok: true, version: input.version };
    params.push(id);
    const r = await tx.query<{ version: number }>(
      `update assets set ${sets.join(", ")}, version = version + 1, updated_at = now() where id = $${params.length} returning version`,
      params,
    );
    return { ok: true, version: Number(r.rows[0].version) };
  });
}

/** Organizations where the principal may register devices. */
export function registrableCustomers(p: Principal) {
  return p.memberships.filter((m) => STAFF_ROLES.includes(m.role)).map((m) => ({ id: m.customerId, name: m.customerName }));
}

/** Active assets whose warranty ends within the next `days` days, or ended recently (org view). */
export async function warrantyExpiring(p: Principal, days = 60) {
  const targets = p.memberships.filter((m) => canSeeOrgFor(p, m.customerId)).map((m) => m.customerId);
  if (!targets.length) return [];
  return withUser(p.userId, async (tx) => {
    const r = await tx.query(
      `${SELECT} where a.customer_id = any($1::uuid[]) and a.status = 'active' and a.warranty_expires is not null
          and a.warranty_expires <= current_date + make_interval(days => $2::int) and a.warranty_expires >= current_date - 30
        order by a.warranty_expires`,
      [targets, days],
    );
    return r.rows.map(toSummary);
  });
}
