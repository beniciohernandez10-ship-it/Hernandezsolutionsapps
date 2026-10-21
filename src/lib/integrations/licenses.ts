import { config } from "../config";
import { asSystem, withUser } from "../db";
import { canSeeOrgFor, customersWhere, ORG_ROLES, type Principal } from "../authz";
import { log, errorSummary } from "../log";
import { getGraphAppToken, graphHost, type GraphDeps } from "./graph";
import { ProviderError, providerFetch, readJsonResponse } from "./http";

/**
 * Read-only Microsoft 365 license inventory.
 *
 * Microsoft Graph v1.0: GET /subscribedSkus (one page; a tenant has few SKUs).
 * Least-privileged application permission: Organization.Read.All, granted by
 * each customer's admin consent to the inventory app registration (the same
 * consent flow as Intune inventory). Nothing is ever assigned or changed.
 */

export interface LicenseSku {
  skuId: string;
  skuPartNumber: string;
  enabled: number;
  suspended: number;
  warning: number;
  consumed: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

export function normaliseSku(raw: Record<string, unknown>): LicenseSku | null {
  const skuId = String(raw.skuId ?? "");
  const part = String(raw.skuPartNumber ?? "").slice(0, 120);
  if (!UUID.test(skuId) || !part) return null;
  const pre = (raw.prepaidUnits ?? {}) as Record<string, unknown>;
  return { skuId, skuPartNumber: part, enabled: count(pre.enabled), suspended: count(pre.suspended), warning: count(pre.warning), consumed: count(raw.consumedUnits) };
}

export async function fetchSubscribedSkus(tenantId: string, deps: GraphDeps = {}): Promise<{ skus: LicenseSku[]; skipped: number }> {
  const token = await getGraphAppToken(tenantId, deps);
  const res = await providerFetch(
    `${config().graph.baseUrl}/v1.0/subscribedSkus?$select=skuId,skuPartNumber,prepaidUnits,consumedUnits`,
    { headers: { authorization: `Bearer ${token}`, accept: "application/json" } },
    { allowedHosts: [graphHost()], fetchImpl: deps.fetchImpl, sleep: deps.sleep },
  );
  if (!res.ok) {
    throw new ProviderError(
      res.status === 403 ? "Graph refused license access (Organization.Read.All not consented)." : `Graph returned ${res.status} listing licenses.`,
      { status: res.status, retryable: res.status >= 500 || res.status === 429 },
    );
  }
  const body = await readJsonResponse<{ value?: unknown }>(res);
  if (!Array.isArray(body.value)) throw new ProviderError("Graph response missing value array.", { retryable: false });
  const skus: LicenseSku[] = [];
  let skipped = 0;
  for (const raw of body.value) {
    const s = raw && typeof raw === "object" ? normaliseSku(raw as Record<string, unknown>) : null;
    if (s) skus.push(s);
    else skipped++;
  }
  return { skus, skipped };
}

async function recordSync(customerId: string, status: string, o: { error?: string | null; records?: number; skipped?: number } = {}) {
  await asSystem((tx) =>
    tx.query(
      `insert into sync_states (customer_id, provider, resource, status, last_attempt_at, last_success_at, last_error, records, skipped_records)
       values ($1, 'microsoft365', 'licenses', $2, now(), case when $2 = 'synchronized' then now() end, $3, $4, $5)
       on conflict (customer_id, provider, resource) do update set status = excluded.status, last_attempt_at = now(),
         last_success_at = coalesce(excluded.last_success_at, sync_states.last_success_at),
         last_error = excluded.last_error, records = coalesce(excluded.records, sync_states.records),
         skipped_records = coalesce(excluded.skipped_records, sync_states.skipped_records)`,
      [customerId, status, o.error ?? null, o.records ?? null, o.skipped ?? null],
    ),
  );
}

/** Job handler: replaces one customer's license snapshot, only after a successful read. */
export async function syncLicenses(customerId: string, deps: GraphDeps = {}) {
  const dir = await asSystem((tx) =>
    tx.query<{ tenant_id: string }>(
      `select d.tenant_id from customer_entra_directories ced join entra_directories d on d.id = ced.directory_id
         join customers c on c.id = ced.customer_id
        where ced.customer_id = $1 and ced.inventory_enabled and d.inventory_consent_at is not null and c.status = 'active'`,
      [customerId],
    ),
  );
  if (dir.rows.length !== 1) {
    await recordSync(customerId, "needs_review", { error: dir.rows.length === 0 ? "No directory with recorded inventory consent." : "Multiple inventory directories; choose one." });
    return { status: "needs_review" as const };
  }
  let result: { skus: LicenseSku[]; skipped: number };
  try {
    result = await fetchSubscribedSkus(dir.rows[0].tenant_id, deps);
  } catch (err) {
    log.warn("licenses.sync_failed", { customerId, error: errorSummary(err) });
    await recordSync(customerId, "failed", { error: err instanceof ProviderError ? err.message : "Unexpected error during import." });
    throw err;
  }
  await asSystem(async (tx) => {
    await tx.query("delete from license_inventory where customer_id = $1", [customerId]);
    for (const s of result.skus) {
      await tx.query(
        `insert into license_inventory (customer_id, sku_id, sku_part_number, enabled, suspended, warning, consumed, captured_at)
         values ($1, $2, $3, $4, $5, $6, $7, now())`,
        [customerId, s.skuId, s.skuPartNumber, s.enabled, s.suspended, s.warning, s.consumed],
      );
    }
  });
  await recordSync(customerId, "synchronized", { records: result.skus.length, skipped: result.skipped });
  return { status: "synchronized" as const, records: result.skus.length };
}

/**
 * Display names for common SKU part numbers. The part number is always shown
 * too, so anything unmapped (or mapped wrongly) is still identifiable.
 */
const SKU_NAMES: Record<string, string> = {
  SPB: "Microsoft 365 Business Premium",
  O365_BUSINESS_PREMIUM: "Microsoft 365 Business Standard",
  O365_BUSINESS_ESSENTIALS: "Microsoft 365 Business Basic",
  O365_BUSINESS: "Microsoft 365 Apps for business",
  OFFICESUBSCRIPTION: "Microsoft 365 Apps for enterprise",
  STANDARDPACK: "Office 365 E1",
  ENTERPRISEPACK: "Office 365 E3",
  SPE_E3: "Microsoft 365 E3",
  SPE_E5: "Microsoft 365 E5",
  EXCHANGESTANDARD: "Exchange Online (Plan 1)",
  EXCHANGEENTERPRISE: "Exchange Online (Plan 2)",
  AAD_PREMIUM: "Microsoft Entra ID P1",
  AAD_PREMIUM_P2: "Microsoft Entra ID P2",
  INTUNE_A: "Microsoft Intune Plan 1",
  POWER_BI_STANDARD: "Power BI (free)",
  POWER_BI_PRO: "Power BI Pro",
  FLOW_FREE: "Power Automate (free)",
};

export interface LicenseRow extends LicenseSku {
  name: string | null;
  available: number;
  capturedAt: string;
}

export interface CustomerLicenses {
  customerId: string;
  customerName: string;
  rows: LicenseRow[];
  sync: { status: string; lastSuccessAt: string | null; lastError: string | null } | null;
}

/** License snapshots for the customers the viewer can see (client admins and technicians). */
export async function listLicenses(p: Principal): Promise<CustomerLicenses[]> {
  const customers = customersWhere(p, (r) => ORG_ROLES.includes(r));
  if (!customers.length) return [];
  return withUser(p.userId, async (tx) => {
    const rows = await tx.query<Record<string, unknown>>("select * from license_inventory where customer_id = any($1::uuid[]) order by sku_part_number", [customers]);
    const sync = await tx.query<Record<string, unknown>>(
      "select customer_id, status, last_success_at, last_error from sync_states where provider = 'microsoft365' and resource = 'licenses' and customer_id = any($1::uuid[])",
      [customers],
    );
    return p.memberships
      .filter((m) => canSeeOrgFor(p, m.customerId))
      .map((m) => {
        const s = sync.rows.find((x) => x.customer_id === m.customerId);
        return {
          customerId: m.customerId,
          customerName: m.customerName,
          rows: rows.rows
            .filter((r) => r.customer_id === m.customerId)
            .map((r) => {
              const enabled = Number(r.enabled);
              const consumed = Number(r.consumed);
              return {
                skuId: r.sku_id as string,
                skuPartNumber: r.sku_part_number as string,
                name: SKU_NAMES[r.sku_part_number as string] ?? null,
                enabled,
                suspended: Number(r.suspended),
                warning: Number(r.warning),
                consumed,
                available: Math.max(0, enabled - consumed),
                capturedAt: new Date(r.captured_at as string).toISOString(),
              };
            }),
          sync: s
            ? {
                status: s.status as string,
                lastSuccessAt: s.last_success_at ? new Date(s.last_success_at as string).toISOString() : null,
                // Provider error text is for staff; client admins see a generic line.
                lastError: s.last_error ? (p.memberships.find((x) => x.customerId === m.customerId)?.role === "client_admin" ? "Last update failed." : (s.last_error as string)) : null,
              }
            : null,
        };
      });
  });
}
