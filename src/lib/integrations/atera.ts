import { config } from "../config";
import { asSystem } from "../db";
import { log, errorSummary } from "../log";
import { assertAllowedUrl, providerFetch, ProviderError, readJsonResponse, type HttpPolicy } from "./http";

/**
 * Read-only Atera adapter.
 *
 * CONTRACT STATUS: NOT YET VERIFIED against the Hernandez Solutions Atera
 * account. Atera's interactive API reference (app.atera.com/apidocs) could not
 * be read from the build environment. The values below come from Atera's
 * public v3 API as used by community clients (base URL, X-API-KEY header,
 * `items` + `nextLink` pagination) and must be confirmed with
 * docs/atera-contract-verification.md before enabling imports. Every
 * assumption is isolated in ATERA_CONTRACT so verification touches one place.
 *
 * An Atera API key is account-wide. Holding it does not authorise access to a
 * given customer's data, so every imported record must carry the mapped Atera
 * customer ID; if any record does not, the whole import fails closed.
 */
export const ATERA_CONTRACT = {
  apiPrefix: "/api/v3",
  authHeader: "X-API-KEY",
  pageSizeParam: "itemsInPage",
  pageSize: 50,
  itemsField: "items",
  nextLinkField: "nextLink",
  customerPath: (id: number) => `/customers/${id}`,
  customerIdField: "CustomerID",
  customerNameField: "CustomerName",
  agentsForCustomerPath: (id: number) => `/agents/customer/${id}`,
  agent: {
    idField: "AgentID",
    customerIdField: "CustomerID",
    nameField: "MachineName",
    osField: "OS",
    osTypeField: "OSType",
  },
  verified: false,
} as const;

const MAX_PAGES = 200;

interface Deps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
}

function host() {
  return new URL(config().atera.baseUrl).hostname.toLowerCase();
}

function apiKey(envVar: string, env: NodeJS.ProcessEnv = process.env) {
  if (!/^ATERA_API_KEY(_[A-Z0-9]+)?$/.test(envVar)) throw new ProviderError("Invalid Atera key reference.", { retryable: false });
  const key = env[envVar];
  if (!key) throw new ProviderError(`Atera key ${envVar} is not set in the server environment.`, { retryable: false });
  return key;
}

async function get(path: string, key: string, deps: Deps) {
  const url = path.startsWith("https://") ? path : `${config().atera.baseUrl}${ATERA_CONTRACT.apiPrefix}${path}`;
  const policy: HttpPolicy = { allowedHosts: [host()], fetchImpl: deps.fetchImpl, sleep: deps.sleep };
  const res = await providerFetch(url, { headers: { [ATERA_CONTRACT.authHeader]: key, accept: "application/json" } }, policy);
  if (res.status === 404) return null;
  if (!res.ok) throw new ProviderError(`Atera returned ${res.status}.`, { status: res.status, retryable: res.status >= 500 || res.status === 429 });
  return readJsonResponse<Record<string, unknown>>(res);
}

export function validateAteraNextLink(link: string) {
  const u = assertAllowedUrl(link, [host()]);
  if (!u.pathname.startsWith(`${ATERA_CONTRACT.apiPrefix}/`)) throw new ProviderError("Unexpected Atera pagination destination.", { retryable: false });
  return u.toString();
}

export async function paginate(path: string, key: string, deps: Deps = {}) {
  const sep = path.includes("?") ? "&" : "?";
  let next: string | undefined = `${path}${sep}${ATERA_CONTRACT.pageSizeParam}=${ATERA_CONTRACT.pageSize}`;
  const items: Record<string, unknown>[] = [];
  for (let page = 0; next; page++) {
    if (page >= MAX_PAGES) throw new ProviderError("Atera pagination exceeded the safety limit.", { retryable: false });
    const body = await get(next, key, deps);
    if (!body) break;
    const pageItems = body[ATERA_CONTRACT.itemsField];
    if (!Array.isArray(pageItems)) throw new ProviderError("Atera response did not match the expected list contract.", { retryable: false });
    for (const i of pageItems) if (i && typeof i === "object") items.push(i as Record<string, unknown>);
    const link = body[ATERA_CONTRACT.nextLinkField];
    next = typeof link === "string" && link ? validateAteraNextLink(link) : undefined;
  }
  return items;
}

async function mapping(customerId: string, connectionId?: string) {
  const r = await asSystem((tx) =>
    tx.query<{ connection_id: string; atera_customer_id: string; api_key_env_var: string; verified_at: string | null }>(
      `select m.connection_id, m.atera_customer_id::text, c.api_key_env_var, m.verified_at
         from customer_atera_mappings m join atera_connections c on c.id = m.connection_id
         join customers cu on cu.id = m.customer_id
        where m.customer_id = $1 and c.enabled and cu.status = 'active' ${connectionId ? "and m.connection_id = $2" : ""}`,
      connectionId ? [customerId, connectionId] : [customerId],
    ),
  );
  return r.rows;
}

/** Confirms the mapped Atera customer exists and returns its own ID. Read-only. */
export async function verifyAteraMapping(customerId: string, connectionId: string, deps: Deps = {}) {
  const [m] = await mapping(customerId, connectionId);
  if (!m) throw new ProviderError("No active Atera mapping for this customer.", { retryable: false });
  const ateraId = Number(m.atera_customer_id);
  const body = await get(ATERA_CONTRACT.customerPath(ateraId), apiKey(m.api_key_env_var, deps.env), deps);
  const returnedId = body ? Number(body[ATERA_CONTRACT.customerIdField]) : NaN;
  if (!body || returnedId !== ateraId) {
    await setSync(customerId, "customer", "needs_review", "Atera customer lookup did not return the mapped customer.");
    return { verified: false };
  }
  const name = String(body[ATERA_CONTRACT.customerNameField] ?? "").slice(0, 200);
  await asSystem((tx) =>
    tx.query("update customer_atera_mappings set verified_at = now(), verified_name = $3 where customer_id = $1 and connection_id = $2", [
      customerId,
      connectionId,
      name,
    ]),
  );
  await setSync(customerId, "customer", "synchronized", null);
  return { verified: true, name };
}

/**
 * Imports Atera agents (devices) for one mapped customer. Fails closed: if
 * any returned record does not carry the mapped customer ID, nothing is
 * imported and the sync is marked needs_review.
 */
export async function syncAteraAgents(customerId: string, deps: Deps = {}) {
  const maps = (await mapping(customerId)).filter((m) => m.verified_at);
  if (maps.length !== 1) {
    await setSync(customerId, "agents", "needs_review", maps.length ? "Multiple Atera mappings; choose one." : "Atera mapping is not verified.");
    return { status: "needs_review" as const };
  }
  const m = maps[0];
  const ateraId = Number(m.atera_customer_id);
  await setSync(customerId, "agents", "pending", null);
  let items: Record<string, unknown>[];
  try {
    items = await paginate(ATERA_CONTRACT.agentsForCustomerPath(ateraId), apiKey(m.api_key_env_var, deps.env), deps);
  } catch (err) {
    log.warn("atera.sync_failed", { customerId, error: errorSummary(err) });
    await setSync(customerId, "agents", "failed", err instanceof ProviderError ? err.message : "Unexpected error during import.");
    throw err;
  }
  const f = ATERA_CONTRACT.agent;
  const foreign = items.filter((i) => Number(i[f.customerIdField]) !== ateraId);
  const invalid = items.filter((i) => !Number.isSafeInteger(Number(i[f.idField])));
  if (foreign.length || invalid.length) {
    await setSync(
      customerId,
      "agents",
      "needs_review",
      `Ownership could not be established for ${foreign.length + invalid.length} record(s); nothing was imported.`,
    );
    return { status: "needs_review" as const, foreign: foreign.length, invalid: invalid.length };
  }
  await asSystem(async (tx) => {
    const seen: number[] = [];
    for (const i of items) {
      const agentId = Number(i[f.idField]);
      seen.push(agentId);
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
      await tx.query(
        `insert into devices (customer_id, source, atera_agent_id, name, operating_system, os_version, imported_at, removed_at)
         values ($1, 'atera', $2, $3, $4, $5, now(), null)
         on conflict (customer_id, atera_agent_id) do update set name = excluded.name, operating_system = excluded.operating_system,
           os_version = excluded.os_version, imported_at = now(), removed_at = null`,
        [customerId, agentId, str(i[f.nameField]) ?? "(unnamed agent)", str(i[f.osTypeField]), str(i[f.osField])],
      );
    }
    await tx.query(
      `update devices set removed_at = now() where customer_id = $1 and source = 'atera' and removed_at is null
         and not (atera_agent_id = any($2::bigint[]))`,
      [customerId, seen],
    );
    await tx.query(
      `insert into sync_states (customer_id, provider, resource, status, last_attempt_at, last_success_at, last_error, records)
       values ($1, 'atera', 'agents', 'synchronized', now(), now(), null, $2)
       on conflict (customer_id, provider, resource) do update set status = 'synchronized', last_attempt_at = now(),
         last_success_at = now(), last_error = null, records = excluded.records`,
      [customerId, items.length],
    );
  });
  return { status: "synchronized" as const, records: items.length };
}

async function setSync(customerId: string, resource: string, status: string, error: string | null) {
  await asSystem((tx) =>
    tx.query(
      `insert into sync_states (customer_id, provider, resource, status, last_attempt_at, last_error)
       values ($1, 'atera', $2, $3, now(), $4)
       on conflict (customer_id, provider, resource) do update set status = excluded.status, last_attempt_at = now(),
         last_error = case when excluded.status = 'pending' then sync_states.last_error else excluded.last_error end`,
      [customerId, resource, status, error],
    ),
  );
}
