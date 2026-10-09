import { config } from "../config";
import { asSystem } from "../db";
import { log, errorSummary } from "../log";
import { providerFetch, ProviderError, readJsonResponse, assertAllowedUrl, type HttpPolicy } from "./http";

/**
 * Read-only Intune managed-device inventory via Microsoft Graph v1.0.
 *
 * Verified against Microsoft Learn ("List managedDevices", graph-rest-1.0):
 *   GET /deviceManagement/managedDevices
 *   least-privileged application permission: DeviceManagementManagedDevices.Read.All
 *   properties: id, deviceName, operatingSystem, osVersion, complianceState,
 *               lastSyncDateTime, azureADDeviceId
 *   complianceState: unknown | compliant | noncompliant | conflict | error | inGracePeriod | configManager
 *
 * Uses a *separate* app registration (GRAPH_CLIENT_ID) from user sign-in, with
 * admin consent granted in each customer directory. Requires the customer to
 * hold Intune licensing. No write, wipe, retire, reboot or script operations
 * exist in this module.
 */

export const MANAGED_DEVICE_FIELDS = [
  "id",
  "deviceName",
  "operatingSystem",
  "osVersion",
  "complianceState",
  "lastSyncDateTime",
  "azureADDeviceId",
] as const;

const COMPLIANCE = new Set(["unknown", "compliant", "noncompliant", "conflict", "error", "inGracePeriod", "configManager"]);
const MAX_PAGES = 500;

export interface ManagedDevice {
  intuneManagedDeviceId: string;
  entraDeviceId: string | null;
  name: string;
  operatingSystem: string | null;
  osVersion: string | null;
  complianceState: string;
  lastSyncAt: string | null;
}

interface GraphDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

function graphHost() {
  return new URL(config().graph.baseUrl).hostname.toLowerCase();
}
function loginHost() {
  return new URL(config().entra.authorityHost).hostname.toLowerCase();
}

const tokenCache = new Map<string, { token: string; exp: number }>();

export async function getGraphAppToken(tenantId: string, deps: GraphDeps = {}): Promise<string> {
  const g = config().graph;
  if (!g.clientId || !g.clientSecret) throw new ProviderError("Graph inventory app registration is not configured.", { retryable: false });
  const hit = tokenCache.get(tenantId);
  if (hit && hit.exp > Date.now() + 300_000) return hit.token;
  const res = await providerFetch(
    `${config().entra.authorityHost}/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: g.clientId,
        client_secret: g.clientSecret,
        grant_type: "client_credentials",
        scope: `${config().graph.baseUrl}/.default`,
      }),
    },
    { allowedHosts: [loginHost()], fetchImpl: deps.fetchImpl, sleep: deps.sleep },
  );
  if (!res.ok) {
    throw new ProviderError(`Token request for directory failed (${res.status}). Check admin consent.`, { status: res.status, retryable: res.status >= 500 });
  }
  const body = await readJsonResponse<{ access_token?: string; expires_in?: number }>(res);
  if (!body.access_token) throw new ProviderError("Token response missing access_token.", { retryable: false });
  tokenCache.set(tenantId, { token: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 });
  return body.access_token;
}

export function clearGraphTokenCache() {
  tokenCache.clear();
}

/** Validates an @odata.nextLink before any credential is attached to it. */
export function validateNextLink(link: string) {
  const u = assertAllowedUrl(link, [graphHost()]);
  if (!u.pathname.startsWith("/v1.0/deviceManagement/managedDevices")) {
    throw new ProviderError("Unexpected pagination destination from Graph.", { retryable: false });
  }
  return u.toString();
}

export function normaliseDevice(raw: Record<string, unknown>): ManagedDevice | null {
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id || id.length > 128) return null;
  const s = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const compliance = typeof raw.complianceState === "string" && COMPLIANCE.has(raw.complianceState) ? raw.complianceState : "unknown";
  const entra = s(raw.azureADDeviceId, 64);
  return {
    intuneManagedDeviceId: id,
    // Graph returns an all-zero GUID when the device is not registered in Entra.
    entraDeviceId: entra && entra !== "00000000-0000-0000-0000-000000000000" ? entra : null,
    name: s(raw.deviceName) ?? "(unnamed device)",
    operatingSystem: s(raw.operatingSystem, 64),
    osVersion: s(raw.osVersion, 64),
    complianceState: compliance,
    lastSyncAt: s(raw.lastSyncDateTime, 40),
  };
}

export async function fetchManagedDevices(tenantId: string, deps: GraphDeps = {}): Promise<{ devices: ManagedDevice[]; skipped: number }> {
  const token = await getGraphAppToken(tenantId, deps);
  const policy: HttpPolicy = { allowedHosts: [graphHost()], fetchImpl: deps.fetchImpl, sleep: deps.sleep };
  let url: string | undefined =
    `${config().graph.baseUrl}/v1.0/deviceManagement/managedDevices?$select=${MANAGED_DEVICE_FIELDS.join(",")}`;
  const devices: ManagedDevice[] = [];
  let skipped = 0;
  for (let page = 0; url; page++) {
    if (page >= MAX_PAGES) throw new ProviderError("Graph pagination exceeded the safety limit.", { retryable: false });
    const res = await providerFetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } }, policy);
    if (!res.ok) {
      throw new ProviderError(`Graph returned ${res.status} listing managed devices.`, {
        status: res.status,
        retryable: res.status >= 500 || res.status === 429,
      });
    }
    const body = await readJsonResponse<{ value?: unknown; "@odata.nextLink"?: unknown }>(res);
    if (!Array.isArray(body.value)) throw new ProviderError("Graph response missing value array.", { retryable: false });
    for (const raw of body.value) {
      const d = raw && typeof raw === "object" ? normaliseDevice(raw as Record<string, unknown>) : null;
      if (d) devices.push(d);
      else skipped++;
    }
    const next = body["@odata.nextLink"];
    url = typeof next === "string" ? validateNextLink(next) : undefined;
  }
  return { devices, skipped };
}

/**
 * Imports one customer's inventory. The prior snapshot is only replaced after
 * every page was fetched successfully; on any failure the previous devices
 * remain and the failure is recorded on sync_states.
 */
export async function syncIntuneDevices(customerId: string, deps: GraphDeps = {}) {
  const dir = await asSystem((tx) =>
    tx.query<{ tenant_id: string }>(
      `select d.tenant_id from customer_entra_directories ced join entra_directories d on d.id = ced.directory_id
         join customers c on c.id = ced.customer_id
        where ced.customer_id = $1 and ced.inventory_enabled and d.inventory_consent_at is not null and c.status = 'active'`,
      [customerId],
    ),
  );
  if (dir.rows.length !== 1) {
    await recordSync(customerId, "needs_review", {
      error: dir.rows.length === 0 ? "No directory with recorded inventory consent." : "Multiple inventory directories; choose one.",
    });
    return { status: "needs_review" as const };
  }
  await recordSync(customerId, "pending", {});
  let result: { devices: ManagedDevice[]; skipped: number };
  try {
    result = await fetchManagedDevices(dir.rows[0].tenant_id, deps);
  } catch (err) {
    log.warn("intune.sync_failed", { customerId, error: errorSummary(err) });
    await recordSync(customerId, "failed", { error: err instanceof ProviderError ? err.message : "Unexpected error during import." });
    throw err;
  }
  await asSystem(async (tx) => {
    const seen: string[] = [];
    for (const d of result.devices) {
      seen.push(d.intuneManagedDeviceId);
      await tx.query(
        `insert into devices (customer_id, source, intune_managed_device_id, entra_device_id, name, operating_system, os_version,
                              compliance_state, last_provider_sync_at, imported_at, removed_at)
         values ($1, 'intune', $2, $3, $4, $5, $6, $7, $8, now(), null)
         on conflict (customer_id, intune_managed_device_id) do update set
           entra_device_id = excluded.entra_device_id, name = excluded.name, operating_system = excluded.operating_system,
           os_version = excluded.os_version, compliance_state = excluded.compliance_state,
           last_provider_sync_at = excluded.last_provider_sync_at, imported_at = now(), removed_at = null`,
        [customerId, d.intuneManagedDeviceId, d.entraDeviceId, d.name, d.operatingSystem, d.osVersion, d.complianceState, d.lastSyncAt],
      );
    }
    await tx.query(
      `update devices set removed_at = now()
        where customer_id = $1 and source = 'intune' and removed_at is null and not (intune_managed_device_id = any($2::text[]))`,
      [customerId, seen],
    );
    await tx.query(
      `insert into sync_states (customer_id, provider, resource, status, last_attempt_at, last_success_at, last_error, records, skipped_records)
       values ($1, 'intune', 'managed_devices', 'synchronized', now(), now(), null, $2, $3)
       on conflict (customer_id, provider, resource) do update set status = 'synchronized', last_attempt_at = now(),
         last_success_at = now(), last_error = null, records = excluded.records, skipped_records = excluded.skipped_records`,
      [customerId, result.devices.length, result.skipped],
    );
  });
  return { status: "synchronized" as const, records: result.devices.length, skipped: result.skipped };
}

async function recordSync(customerId: string, status: string, o: { error?: string }) {
  await asSystem((tx) =>
    tx.query(
      `insert into sync_states (customer_id, provider, resource, status, last_attempt_at, last_error)
       values ($1, 'intune', 'managed_devices', $2, now(), $3)
       on conflict (customer_id, provider, resource) do update set status = excluded.status, last_attempt_at = now(),
         last_error = coalesce(excluded.last_error, sync_states.last_error)`,
      [customerId, status, o.error ?? null],
    ),
  );
}
