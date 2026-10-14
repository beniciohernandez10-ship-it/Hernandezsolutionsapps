import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshDatabase } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem } from "@/lib/db";
import { loadConfig, setConfigForTesting } from "@/lib/config";
import { clearGraphTokenCache, fetchManagedDevices, syncIntuneDevices } from "@/lib/integrations/graph";
import { syncAteraAgents, verifyAteraMapping } from "@/lib/integrations/atera";
import { providerFetch, ProviderError, parseRetryAfter } from "@/lib/integrations/http";
import { claimJobs, enqueue, processJobs, registerJobHandler, runJob } from "@/lib/jobs";

const C = DEMO.customers.contoso;
const TID = DEMO.directories.contoso;
const noSleep = async () => {};

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;
function mockFetch(route: Route) {
  const calls: { url: string; auth?: string | null }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const h = new Headers(init?.headers);
    calls.push({ url: url.toString(), auth: h.get("authorization") ?? h.get("x-api-key") });
    return route(url, init);
  }) as typeof fetch;
  return { f, calls };
}
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
const tokenOk = () => json({ access_token: "graph-token", expires_in: 3600 });

const dev = (id: string, extra: object = {}) => ({
  id,
  deviceName: `PC-${id}`,
  operatingSystem: "Windows",
  osVersion: "10.0.26100",
  complianceState: "compliant",
  lastSyncDateTime: "2026-10-09T12:00:00Z",
  azureADDeviceId: `aad-${id}`,
  ...extra,
});

beforeAll(async () => {
  await freshDatabase();
  await asSystem(async (tx) => {
    await tx.query("update entra_directories set inventory_consent_at = now() where tenant_id = $1", [TID]);
    await tx.query("update customer_entra_directories set inventory_enabled = true where customer_id = $1", [C]);
  });
});

beforeEach(() => {
  clearGraphTokenCache();
  setConfigForTesting({
    ...loadConfig({}),
    graph: { clientId: "graph-app", clientSecret: "test-only", baseUrl: "https://graph.microsoft.com" },
  });
});

describe("HTTP policy", () => {
  it("parses Retry-After seconds and dates", () => {
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter(new Date(Date.now() + 10_000).toUTCString())).toBeGreaterThan(8000);
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it("refuses non-allow-listed or non-HTTPS destinations before sending", async () => {
    const m = mockFetch(() => json({}));
    await expect(providerFetch("https://evil.example/x", {}, { allowedHosts: ["graph.microsoft.com"], fetchImpl: m.f })).rejects.toThrow(/unapproved/);
    await expect(providerFetch("http://graph.microsoft.com/x", {}, { allowedHosts: ["graph.microsoft.com"], fetchImpl: m.f })).rejects.toThrow(/unapproved/);
    expect(m.calls).toHaveLength(0);
  });

  it("honours Retry-After with bounded retries", async () => {
    let n = 0;
    const waits: number[] = [];
    const m = mockFetch(() => (++n < 3 ? json({}, 429, { "retry-after": "2" }) : json({ ok: true })));
    const r = await providerFetch("https://graph.microsoft.com/x", {}, { allowedHosts: ["graph.microsoft.com"], fetchImpl: m.f, sleep: async (ms) => void waits.push(ms) });
    expect(r.status).toBe(200);
    expect(waits).toEqual([2000, 2000]);
    const always = mockFetch(() => json({}, 429, { "retry-after": "1" }));
    await expect(providerFetch("https://graph.microsoft.com/x", {}, { allowedHosts: ["graph.microsoft.com"], fetchImpl: always.f, sleep: noSleep })).rejects.toThrow(/throttled/);
    expect(always.calls).toHaveLength(4);
  });

  it("does not follow redirects", async () => {
    const m = mockFetch(() => new Response(null, { status: 302, headers: { location: "https://evil.example" } }));
    await expect(providerFetch("https://graph.microsoft.com/x", {}, { allowedHosts: ["graph.microsoft.com"], fetchImpl: m.f })).rejects.toThrow(/redirect/);
  });

  it("never retries a non-idempotent call and flags an ambiguous outcome", async () => {
    const m = mockFetch(() => {
      const e = new Error("timeout");
      e.name = "TimeoutError";
      throw e;
    });
    const err = await providerFetch("https://app.atera.com/api/v3/tickets", { method: "POST" }, { allowedHosts: ["app.atera.com"], fetchImpl: m.f, sleep: noSleep }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).opts.ambiguous).toBe(true);
    expect(m.calls).toHaveLength(1);
  });
});

describe("Intune managed-device inventory", () => {
  it("follows validated @odata.nextLink pagination and keeps only needed fields", async () => {
    const m = mockFetch((url) => {
      if (url.hostname === "login.microsoftonline.com") return tokenOk();
      if (url.searchParams.get("$skiptoken") === "2") return json({ value: [dev("c")] });
      expect(url.searchParams.get("$select")).toContain("complianceState");
      return json({ value: [dev("a"), dev("b", { azureADDeviceId: "00000000-0000-0000-0000-000000000000" }), { nope: 1 }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$skiptoken=2" });
    });
    const r = await fetchManagedDevices(TID, { fetchImpl: m.f, sleep: noSleep });
    expect(r.devices.map((d) => d.intuneManagedDeviceId)).toEqual(["a", "b", "c"]);
    expect(r.devices[1].entraDeviceId).toBeNull();
    expect(r.devices[0].entraDeviceId).toBe("aad-a");
    expect(r.skipped).toBe(1);
    expect(m.calls.find((c) => c.url.includes("login."))!.url).toContain(`/${TID}/oauth2/v2.0/token`);
  });

  it("refuses a nextLink pointing outside Graph and never sends the token there", async () => {
    const m = mockFetch((url) => {
      if (url.hostname === "login.microsoftonline.com") return tokenOk();
      return json({ value: [dev("a")], "@odata.nextLink": "https://attacker.example/v1.0/deviceManagement/managedDevices?x=1" });
    });
    await expect(fetchManagedDevices(TID, { fetchImpl: m.f, sleep: noSleep })).rejects.toThrow(/unapproved/);
    expect(m.calls.some((c) => c.url.includes("attacker"))).toBe(false);
  });

  it("refuses a Graph nextLink to an unexpected path", async () => {
    const m = mockFetch((url) => {
      if (url.hostname === "login.microsoftonline.com") return tokenOk();
      return json({ value: [], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users" });
    });
    await expect(fetchManagedDevices(TID, { fetchImpl: m.f, sleep: noSleep })).rejects.toThrow(/pagination destination/);
  });

  it("imports a snapshot, then preserves it when a later import fails part-way", async () => {
    const ok = mockFetch((url) => (url.hostname === "login.microsoftonline.com" ? tokenOk() : json({ value: [dev("x1"), dev("x2")] })));
    const first = await syncIntuneDevices(C, { fetchImpl: ok.f, sleep: noSleep });
    expect(first).toMatchObject({ status: "synchronized", records: 2 });

    let page = 0;
    const partial = mockFetch((url) => {
      if (url.hostname === "login.microsoftonline.com") return tokenOk();
      page++;
      return page === 1
        ? json({ value: [dev("x1")], "@odata.nextLink": "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$skiptoken=2" })
        : json({ error: "boom" }, 500);
    });
    await expect(syncIntuneDevices(C, { fetchImpl: partial.f, sleep: noSleep })).rejects.toThrow();
    const rows = await asSystem((tx) =>
      tx.query("select intune_managed_device_id from devices where customer_id = $1 and source = 'intune' and removed_at is null order by 1", [C]),
    );
    expect(rows.rows.map((r) => r.intune_managed_device_id)).toEqual(["x1", "x2"]);
    const s = await asSystem((tx) => tx.query("select status, last_success_at, last_error from sync_states where customer_id = $1 and provider = 'intune'", [C]));
    expect(s.rows[0].status).toBe("failed");
    expect(s.rows[0].last_success_at).not.toBeNull();
    expect(s.rows[0].last_error).toMatch(/500/);
  });

  it("marks devices missing from a successful import as removed", async () => {
    const m = mockFetch((url) => (url.hostname === "login.microsoftonline.com" ? tokenOk() : json({ value: [dev("x2")] })));
    await syncIntuneDevices(C, { fetchImpl: m.f, sleep: noSleep });
    const rows = await asSystem((tx) =>
      tx.query("select intune_managed_device_id from devices where customer_id = $1 and source = 'intune' and removed_at is null", [C]),
    );
    expect(rows.rows.map((r) => r.intune_managed_device_id)).toEqual(["x2"]);
  });

  it("needs review when no consented directory is mapped", async () => {
    const r = await syncIntuneDevices(DEMO.customers.fabrikam, { fetchImpl: mockFetch(() => json({})).f });
    expect(r.status).toBe("needs_review");
  });
});

describe("Atera read-only import", () => {
  const env = { ATERA_API_KEY: "test-only-key" };
  let connectionId: string;
  beforeAll(async () => {
    connectionId = await asSystem(async (tx) => {
      const c = await tx.query<{ id: string }>("insert into atera_connections (name, api_key_env_var) values ('Primary (test)', 'ATERA_API_KEY') returning id");
      await tx.query("insert into customer_atera_mappings (customer_id, connection_id, atera_customer_id) values ($1, $2, 42)", [C, c.rows[0].id]);
      return c.rows[0].id;
    });
  });

  it("will not import before the mapping is verified", async () => {
    expect((await syncAteraAgents(C, { env, fetchImpl: mockFetch(() => json({})).f })).status).toBe("needs_review");
  });

  it("verifies the mapping by reading the customer record", async () => {
    const wrong = mockFetch(() => json({ CustomerID: 43, CustomerName: "Someone else" }));
    expect((await verifyAteraMapping(C, connectionId, { env, fetchImpl: wrong.f })).verified).toBe(false);
    const right = mockFetch(() => json({ CustomerID: 42, CustomerName: "Contoso Dental" }));
    expect(await verifyAteraMapping(C, connectionId, { env, fetchImpl: right.f })).toEqual({ verified: true, name: "Contoso Dental" });
    expect(right.calls[0].url).toBe("https://app.atera.com/api/v3/customers/42");
    expect(right.calls[0].auth).toBe("test-only-key");
  });

  it("paginates and imports agents owned by the mapped customer", async () => {
    const m = mockFetch((url) =>
      url.searchParams.get("page") === "2"
        ? json({ items: [{ AgentID: 3, CustomerID: 42, MachineName: "C" }], nextLink: "" })
        : json({ items: [{ AgentID: 1, CustomerID: 42, MachineName: "A", OSType: "Windows" }, { AgentID: 2, CustomerID: 42, MachineName: "B" }], nextLink: "https://app.atera.com/api/v3/agents/customer/42?page=2&itemsInPage=50" }),
    );
    expect(await syncAteraAgents(C, { env, fetchImpl: m.f })).toEqual({ status: "synchronized", records: 3 });
  });

  it("fails closed when any record belongs to another customer", async () => {
    const m = mockFetch(() => json({ items: [{ AgentID: 1, CustomerID: 42 }, { AgentID: 9, CustomerID: 77 }], nextLink: null }));
    expect(await syncAteraAgents(C, { env, fetchImpl: m.f })).toMatchObject({ status: "needs_review", foreign: 1 });
    const rows = await asSystem((tx) => tx.query("select atera_agent_id::int as id from devices where customer_id = $1 and source = 'atera' and removed_at is null order by 1", [C]));
    // The prior snapshot (1, 2, 3) is untouched; agent 9 was not imported.
    expect(rows.rows.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("refuses an off-host nextLink", async () => {
    const m = mockFetch(() => json({ items: [{ AgentID: 1, CustomerID: 42 }], nextLink: "https://evil.example/api/v3/agents" }));
    await expect(syncAteraAgents(C, { env, fetchImpl: m.f })).rejects.toThrow(/unapproved/);
  });

  it("fails without the API key in server configuration", async () => {
    await expect(syncAteraAgents(C, { env: {}, fetchImpl: mockFetch(() => json({})).f })).rejects.toThrow(/not set/);
  });
});

describe("durable jobs", () => {
  it("does not hand the same job to two concurrent claimers", async () => {
    await asSystem((tx) => enqueue(tx, "test.noop", C, {}, "noop-1"));
    const [a, b] = await Promise.all([claimJobs(5), claimJobs(5)]);
    expect([...a, ...b].filter((j) => j.kind === "test.noop")).toHaveLength(1);
  });

  it("deduplicates by key", async () => {
    await asSystem(async (tx) => {
      await enqueue(tx, "test.noop", C, {}, "dedupe-x");
      await enqueue(tx, "test.noop", C, {}, "dedupe-x");
    });
    const r = await asSystem((tx) => tx.query("select count(*)::int as n from jobs where dedupe_key = 'dedupe-x'"));
    expect(r.rows[0].n).toBe(1);
  });

  it("moves an ambiguous provider write to needs_review without retrying", async () => {
    let calls = 0;
    registerJobHandler("test.ambiguous", async () => {
      calls++;
      throw new ProviderError("Provider request timed out.", { retryable: false, ambiguous: true });
    });
    await asSystem((tx) => enqueue(tx, "test.ambiguous", C, {}, "amb-1"));
    await processJobs({ limit: 10, deadlineMs: 5000 });
    await processJobs({ limit: 10, deadlineMs: 5000 });
    const r = await asSystem((tx) => tx.query("select status, attempts from jobs where dedupe_key = 'amb-1'"));
    expect(r.rows[0]).toMatchObject({ status: "needs_review", attempts: 1 });
    expect(calls).toBe(1);
  });

  it("retries transient failures with backoff and gives up after max attempts", async () => {
    registerJobHandler("test.flaky", async () => {
      throw new ProviderError("Provider error 503.", { retryable: true });
    });
    await asSystem((tx) => tx.query("insert into jobs (kind, customer_id, dedupe_key, max_attempts) values ('test.flaky', $1, 'flaky-1', 2)", [C]));
    for (let i = 0; i < 3; i++) {
      const [job] = (await claimJobs(10)).filter((j) => j.kind === "test.flaky");
      if (!job) break;
      await runJob(job);
      await asSystem((tx) => tx.query("update jobs set run_after = now() where dedupe_key = 'flaky-1'"));
    }
    const r = await asSystem((tx) => tx.query("select status, attempts from jobs where dedupe_key = 'flaky-1'"));
    expect(r.rows[0]).toMatchObject({ status: "dead", attempts: 2 });
  });

  it("keeps Atera ticket writes disabled", async () => {
    await asSystem((tx) => enqueue(tx, "atera.ticket_write", C, {}, "write-1"));
    await processJobs({ limit: 10, deadlineMs: 5000 });
    const r = await asSystem((tx) => tx.query("select status, last_error from jobs where dedupe_key = 'write-1'"));
    expect(r.rows[0].status).toBe("dead");
    expect(r.rows[0].last_error).toMatch(/not enabled/);
  });
});
