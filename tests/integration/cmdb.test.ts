import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem, withUser } from "@/lib/db";
import { loadConfig, setConfigForTesting } from "@/lib/config";
import { clearGraphTokenCache } from "@/lib/integrations/graph";
import { listLicenses, normaliseSku, syncLicenses } from "@/lib/integrations/licenses";
import { getAsset, registerAsset, updateAsset, warrantyExpiring } from "@/lib/assets/service";

const U = DEMO.users;
const C = DEMO.customers.contoso;
const F = DEMO.customers.fabrikam;
const TID = DEMO.directories.contoso;
const none = { source: "none" as const };

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const sku = (part: string, enabled: number, consumed: number, id: string) => ({ skuId: id, skuPartNumber: part, prepaidUnits: { enabled, suspended: 0, warning: 0 }, consumedUnits: consumed });

function graph(skus: unknown[], status = 200) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.hostname + url.pathname);
    if (url.hostname === "login.microsoftonline.com") return json({ access_token: "t", expires_in: 3600 });
    if (url.pathname === "/v1.0/subscribedSkus") return status === 200 ? json({ value: skus }) : json({ error: {} }, status);
    return json({}, 404);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

beforeAll(async () => {
  await freshDatabase();
  await asSystem(async (tx) => {
    await tx.query("update entra_directories set inventory_consent_at = now() where tenant_id = $1", [TID]);
    await tx.query("update customer_entra_directories set inventory_enabled = true where customer_id = $1", [C]);
  });
});

beforeEach(() => {
  clearGraphTokenCache();
  setConfigForTesting({ ...loadConfig({}), graph: { clientId: "graph-app", clientSecret: "test-only", baseUrl: "https://graph.microsoft.com" } });
});

describe("Microsoft 365 license inventory", () => {
  it("imports SKUs read-only and shows them to the organization", async () => {
    const g = graph([
      sku("SPB", 10, 7, "cbdc14ab-d96c-4c30-b9f4-6ada7cdc1d46"),
      sku("EXCHANGESTANDARD", 3, 3, "4b9405b0-7788-4568-add1-99614e613b69"),
      { skuId: "not-a-uuid", skuPartNumber: "BAD" },
    ]);
    const r = await syncLicenses(C, { fetchImpl: g.fetchImpl });
    expect(r).toEqual({ status: "synchronized", records: 2 });
    expect(g.calls.every((c) => c.startsWith("login.microsoftonline.com") || c === "graph.microsoft.com/v1.0/subscribedSkus")).toBe(true);
    const [mine] = (await listLicenses(await principal(U.contosoAdmin))).filter((x) => x.customerId === C);
    const bp = mine.rows.find((x) => x.skuPartNumber === "SPB")!;
    expect(bp).toMatchObject({ name: "Microsoft 365 Business Premium", enabled: 10, consumed: 7, available: 3 });
    expect(mine.sync?.status).toBe("synchronized");
    expect(await listLicenses(await principal(U.contosoRequester))).toEqual([]);
    const other = await withUser(U.fabrikamAdmin, (tx) => tx.query("select * from license_inventory where customer_id = $1", [C]));
    expect(other.rows).toHaveLength(0);
  });

  it("keeps the previous snapshot when Graph refuses, and records why", async () => {
    await expect(syncLicenses(C, { fetchImpl: graph([], 403).fetchImpl })).rejects.toThrow(/Organization.Read.All/);
    const [mine] = (await listLicenses(await principal(U.tech))).filter((x) => x.customerId === C);
    expect(mine.rows.length).toBe(2);
    expect(mine.sync?.status).toBe("failed");
    expect(mine.sync?.lastError).toMatch(/Organization.Read.All/);
    const [adminView] = (await listLicenses(await principal(U.contosoAdmin))).filter((x) => x.customerId === C);
    expect(adminView.sync?.lastError).toBe("Last update failed.");
  });

  it("needs recorded consent", async () => {
    expect((await syncLicenses(F, { fetchImpl: graph([]).fetchImpl })).status).toBe("needs_review");
  });

  it("normalises defensively", () => {
    expect(normaliseSku({ skuId: "cbdc14ab-d96c-4c30-b9f4-6ada7cdc1d46", skuPartNumber: "X", prepaidUnits: { enabled: -5 }, consumedUnits: "3" })).toMatchObject({ enabled: 0, consumed: 0 });
  });
});

describe("asset hardware and warranties", () => {
  it("records hardware details, logs changes, and lists warranties ending soon", async () => {
    const tech = await principal(U.tech);
    const soon = new Date(Date.now() + 20 * 86400_000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 400 * 86400_000).toISOString().slice(0, 10);
    const a = await registerAsset(tech, {
      customerId: C, kind: "laptop", primaryUser: none,
      hardware: { manufacturer: "Dell", model: "Latitude 5450", serialNumber: "ABC123", purchaseDate: "2024-01-15", warrantyExpires: soon },
    });
    const b = await registerAsset(tech, { customerId: C, kind: "laptop", primaryUser: none, hardware: { warrantyExpires: later } });
    let d = await getAsset(tech, a.id);
    expect(d).toMatchObject({ manufacturer: "Dell", model: "Latitude 5450", serialNumber: "ABC123", purchaseDate: "2024-01-15", warrantyExpires: soon });
    const list = (await warrantyExpiring(await principal(U.contosoAdmin))).map((x) => x.id);
    expect(list).toContain(a.id);
    expect(list).not.toContain(b.id);
    expect((await warrantyExpiring(await principal(U.fabrikamAdmin))).map((x) => x.id)).not.toContain(a.id);
    await updateAsset(tech, a.id, { version: d.version, hardware: { serialNumber: "XYZ789", model: "" } });
    d = await getAsset(tech, a.id);
    expect(d.serialNumber).toBe("XYZ789");
    expect(d.model).toBeNull();
    expect(d.history[0]).toMatchObject({ action: "hardware_changed" });
    await expectAppError(updateAsset(await principal(U.contosoAdmin), a.id, { version: d.version, hardware: { serialNumber: "x" } }), 403);
    await expectAppError(updateAsset(tech, a.id, { version: d.version, hardware: { purchaseDate: "yesterday" } }), 422);
  });
});
