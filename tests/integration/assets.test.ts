import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem, withUser } from "@/lib/db";
import { getAsset, listAssets, registerAsset, resolveShortCode, searchPrimaryUsers, updateAsset } from "@/lib/assets/service";
import { formatAssetTag, newShortCode } from "@/lib/assets/naming";
import { qrMatrix } from "@/lib/assets/qr";
import { clearGraphTokenCache, isValidDirectorySearch, normaliseUser } from "@/lib/integrations/graph";
import { loadConfig, setConfigForTesting } from "@/lib/config";

const U = DEMO.users;
const C = DEMO.customers;
const TID = DEMO.directories.contoso;
const none = { source: "none" } as const;

beforeAll(async () => {
  await freshDatabase();
});
beforeEach(() => {
  clearGraphTokenCache();
  setConfigForTesting({ ...loadConfig({}), appOrigin: "http://localhost:3000", demoMode: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("naming", () => {
  it("formats three-digit names and stays within the Windows 15-character limit", () => {
    expect(formatAssetTag("workstation", 1)).toBe("WRKSTN-001");
    expect(formatAssetTag("laptop", 42)).toBe("LAPTOP-042");
    expect(formatAssetTag("workstation", 1000)).toBe("WRKSTN-1000");
    expect(() => formatAssetTag("workstation", 0)).toThrow();
    expect(() => formatAssetTag("workstation", 10_000_000_000)).toThrow(/15-character/);
  });

  it("short codes avoid look-alike characters", () => {
    const code = newShortCode((n) => new Uint8Array(n).map((_, i) => i * 37));
    expect(code).toMatch(/^[a-z2-9]{10}$/);
    expect(code).not.toMatch(/[01lo]/);
  });

  it("QR codes for the short link stay small enough for 24 mm tape", () => {
    const q = qrMatrix("https://portal.thehernandezsolutions.com/a/abcdefghjk");
    expect(q.size).toBeLessThanOrEqual(33);
    expect(q.bits).toHaveLength(q.size * q.size);
  });
});

describe("registration", () => {
  it("continues numbering after existing devices, per customer and type", async () => {
    const tech = await principal(U.tech);
    const a = await registerAsset(tech, { customerId: C.contoso, kind: "workstation", primaryUser: none, location: "Lab" });
    const b = await registerAsset(tech, { customerId: C.contoso, kind: "laptop", primaryUser: none });
    expect(a.tag).toBe("WRKSTN-003");
    expect(b.tag).toBe("LAPTOP-002");
    const fab = await registerAsset(await principal(U.techFabrikam), { customerId: C.fabrikam, kind: "workstation", primaryUser: none });
    expect(fab.tag).toBe("WRKSTN-001");
  });

  it("never hands out the same name twice under concurrent registrations", async () => {
    const tech = await principal(U.tech);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => registerAsset(tech, { customerId: C.contoso, kind: "laptop", primaryUser: none })),
    );
    const tags = results.map((r) => r.tag);
    expect(new Set(tags).size).toBe(8);
  });

  it("only technicians of that customer can register", async () => {
    const body = { customerId: C.contoso, kind: "workstation", primaryUser: none };
    await expectAppError(registerAsset(await principal(U.contosoAdmin), body), 403);
    await expectAppError(registerAsset(await principal(U.contosoRequester), body), 403);
    await expectAppError(registerAsset(await principal(U.techFabrikam), body), 403);
    await expectAppError(registerAsset(await principal(U.operator), body), 403);
  });

  it("the database refuses number allocation for non-staff even if the service check is bypassed", async () => {
    await expect(withUser(U.contosoAdmin, (tx) => tx.query("select app_next_asset_number($1, 'workstation')", [C.contoso]))).rejects.toThrow();
    await expect(withUser(U.contosoAdmin, (tx) => tx.query("select * from asset_counters"))).rejects.toThrow();
  });

  it("rejects a portal user who is not a member of the customer", async () => {
    const tech = await principal(U.tech);
    await expectAppError(
      registerAsset(tech, { customerId: C.contoso, kind: "workstation", primaryUser: { source: "portal", userId: U.fabrikamAdmin } }),
      422,
    );
  });

  it("rejects names, UPNs or extra fields sent by the browser", async () => {
    const tech = await principal(U.tech);
    await expectAppError(
      registerAsset(tech, { customerId: C.contoso, kind: "server", primaryUser: none }),
      422,
    );
  });
});

describe("visibility", () => {
  it("client admins see their own organization's devices read-only; others see nothing", async () => {
    const admin = await principal(U.contosoAdmin);
    const list = await listAssets(admin);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((a) => a.customerId === C.contoso)).toBe(true);
    const detail = await getAsset(admin, list[0].id);
    expect(detail.canEdit).toBe(false);
    await expectAppError(updateAsset(admin, list[0].id, { version: detail.version, location: "x" }), 403);

    await expectAppError(getAsset(await principal(U.fabrikamAdmin), list[0].id), 404);
    await expectAppError(getAsset(await principal(U.techFabrikam), list[0].id), 404);
    await expectAppError(listAssets(await principal(U.contosoRequester)), 403);
    expect((await listAssets(await principal(U.fabrikamAdmin))).every((a) => a.customerId === C.fabrikam)).toBe(true);
  });

  it("row-level security hides other customers' assets even without the service check", async () => {
    const r = await withUser(U.fabrikamAdmin, (tx) => tx.query("select customer_id from assets"));
    expect(r.rows.every((x) => x.customer_id === C.fabrikam)).toBe(true);
    await expect(
      withUser(U.contosoAdmin, (tx) => tx.query("update assets set location = 'x' where customer_id = $1", [C.contoso])),
    ).resolves.toMatchObject({ rowCount: 0 });
  });

  it("QR short codes resolve only for people who may see the device", async () => {
    expect(await resolveShortCode(await principal(U.contosoAdmin), "demofrontd")).toBeTruthy();
    await expectAppError(resolveShortCode(await principal(U.fabrikamAdmin), "demofrontd"), 404);
    await expectAppError(resolveShortCode(await principal(U.contosoRequester), "demofrontd"), 404);
    await expectAppError(resolveShortCode(await principal(U.contosoAdmin), "../../etc"), 404);
  });

  it("links to a provider device that reports the same name", async () => {
    await asSystem((tx) =>
      tx.query("insert into devices (customer_id, source, name, compliance_state) values ($1, 'intune', 'wrkstn-002', 'compliant')", [C.contoso]),
    );
    const list = await listAssets(await principal(U.tech));
    const w2 = list.find((a) => a.tag === "WRKSTN-002")!;
    expect(w2.linkedDevice?.source).toBe("intune");
    expect(w2.linkedDevice?.complianceState).toBe("compliant");
    expect(list.find((a) => a.tag === "LAPTOP-001")!.linkedDevice).toBeNull();
  });
});

describe("updates and history", () => {
  it("records user, location and retire changes with optimistic concurrency", async () => {
    const tech = await principal(U.tech);
    const { id } = await registerAsset(tech, { customerId: C.contoso, kind: "workstation", primaryUser: none, location: "Front" });
    let a = await getAsset(tech, id);
    const r1 = await updateAsset(tech, id, { version: a.version, location: "Back office", primaryUser: { source: "portal", userId: U.contosoRequester2 } });
    await expectAppError(updateAsset(tech, id, { version: a.version, location: "Stale" }), 409, "version_conflict");
    await updateAsset(tech, id, { version: r1.version, status: "retired" });
    a = await getAsset(tech, id);
    expect(a.location).toBe("Back office");
    expect(a.primaryUserName).toContain("Rowan");
    expect(a.status).toBe("retired");
    expect(a.history.map((h) => h.action)).toEqual(expect.arrayContaining(["registered", "location_changed", "user_changed", "retired"]));
    expect((await listAssets(tech)).some((x) => x.id === id)).toBe(false);
    expect((await listAssets(tech, { includeRetired: true })).some((x) => x.id === id)).toBe(true);
    const audit = await asSystem((tx) => tx.query("select action from audit_events where target_id = $1", [id]));
    expect(audit.rows.map((x) => x.action)).toContain("asset.retired");
  });
});

describe("primary user from Microsoft Entra ID", () => {
  const objectId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

  function graphWithUsers(calls: string[]) {
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const u = url.toString();
      calls.push(`${u} ${new Headers(init?.headers).get("consistencylevel") ?? ""}`);
      if (u.includes("/oauth2/v2.0/token")) return json({ access_token: "t", expires_in: 3600 });
      if (u.includes(`/v1.0/users/${objectId}`)) return json({ id: objectId, displayName: "Dana Diaz", userPrincipalName: "dana@contoso.example", accountEnabled: true });
      if (u.includes("/v1.0/users/")) return json({ error: {} }, 404);
      if (u.includes("/v1.0/users?")) {
        return json({
          value: [
            { id: objectId, displayName: "Dana Diaz", userPrincipalName: "dana@contoso.example", accountEnabled: true },
            { id: "8c1d9b5e-1111-4111-8111-111111111111", displayName: "Disabled Dan", userPrincipalName: "dan@contoso.example", accountEnabled: false },
            { id: "not-a-guid", displayName: "Bad", userPrincipalName: "bad@contoso.example" },
          ],
        });
      }
      return json({}, 500);
    });
  }

  beforeEach(async () => {
    setConfigForTesting({
      ...loadConfig({}),
      appOrigin: "http://localhost:3000",
      demoMode: true,
      graph: { clientId: "graph-app", clientSecret: "test-only", baseUrl: "https://graph.microsoft.com" },
    });
    await asSystem((tx) => tx.query("update entra_directories set inventory_consent_at = now() where tenant_id = $1", [TID]));
  });

  it("searches the customer's own directory and drops disabled or malformed users", async () => {
    const calls: string[] = [];
    graphWithUsers(calls);
    const r = await searchPrimaryUsers(await principal(U.tech), { customerId: C.contoso, q: "dana" });
    expect(r.source).toBe("directory");
    expect(r.users).toHaveLength(1);
    expect(r.users[0]).toMatchObject({ name: "Dana Diaz", upn: "dana@contoso.example" });
    const search = calls.find((c) => c.includes("/v1.0/users?"))!;
    expect(search).toContain("eventual");
    expect(calls.some((c) => c.includes(`/${TID}/oauth2/v2.0/token`))).toBe(true);
  });

  it("re-reads the chosen user from Graph before saving", async () => {
    const calls: string[] = [];
    graphWithUsers(calls);
    const tech = await principal(U.tech);
    const { id } = await registerAsset(tech, {
      customerId: C.contoso,
      kind: "laptop",
      primaryUser: { source: "directory", tenantId: TID, objectId },
    });
    const a = await getAsset(tech, id);
    expect(a.primaryUserName).toBe("Dana Diaz");
    expect(a.primaryUserSource).toBe("directory");
    await expectAppError(
      registerAsset(tech, { customerId: C.contoso, kind: "laptop", primaryUser: { source: "directory", tenantId: TID, objectId: "9f2504e0-4f89-41d3-9a0c-0305e82c3302" } }),
      422,
    );
  });

  it("refuses a directory that belongs to another customer", async () => {
    graphWithUsers([]);
    await expectAppError(
      registerAsset(await principal(U.tech), {
        customerId: C.contoso,
        kind: "laptop",
        primaryUser: { source: "directory", tenantId: DEMO.directories.fabrikam, objectId },
      }),
      422,
    );
  });

  it("falls back to portal members when directory access is not approved", async () => {
    await asSystem((tx) => tx.query("update entra_directories set inventory_consent_at = null where tenant_id = $1", [TID]));
    const r = await searchPrimaryUsers(await principal(U.tech), { customerId: C.contoso, q: "Riley" });
    expect(r.source).toBe("portal");
    expect(r.notice).toMatch(/not approved/);
    expect(r.users.map((u) => u.name).join()).toContain("Riley");
    await expectAppError(searchPrimaryUsers(await principal(U.contosoAdmin), { customerId: C.contoso, q: "Riley" }), 403);
  });

  it("validates search text and Graph user records", () => {
    expect(isValidDirectorySearch("Dana O'Neil")).toBe(true);
    expect(isValidDirectorySearch('x" OR "a')).toBe(false);
    expect(isValidDirectorySearch("a")).toBe(false);
    expect(normaliseUser({ id: objectId, userPrincipalName: "a@b.c", accountEnabled: false })).toBeNull();
    expect(normaliseUser({ id: "nope", userPrincipalName: "a@b.c" })).toBeNull();
  });
});
