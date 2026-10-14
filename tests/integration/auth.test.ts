import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWTVerifyGetKey } from "jose";
import { NextRequest } from "next/server";
import { freshDatabase } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem } from "@/lib/db";
import { setConfigForTesting, loadConfig } from "@/lib/config";
import { beginSignIn, completeSignIn, setJwksForTesting, setTokenFetchForTesting, validateIdToken, safeReturnTo } from "@/lib/auth/entra";
import { createSession, readSession, revokeSession } from "@/lib/auth/session";
import { GET as meGET } from "@/app/api/me/route";
import { POST as ticketsPOST } from "@/app/api/tickets/route";

const CLIENT_ID = "11111111-2222-4333-8444-555555555555";
const HOST = "https://login.microsoftonline.com";
const TID = DEMO.directories.contoso;
const OID = "99999999-0000-4000-8000-000000000001";

let signer: CryptoKey;
let otherSigner: CryptoKey;
let jwks: JWTVerifyGetKey;

function cfg(extra = {}) {
  setConfigForTesting({
    ...loadConfig({}),
    appOrigin: "http://localhost:3000",
    demoMode: true,
    entra: { clientId: CLIENT_ID, clientSecret: "test-only-not-a-secret", authorityHost: HOST, authorityTenant: "organizations" },
    ...extra,
  });
}

async function token(claims: Record<string, unknown>, key = signer, opts: { exp?: string; iat?: number } = {}) {
  const jwt = new SignJWT({ tid: TID, oid: OID, ver: "2.0", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer((claims.iss as string) ?? `${HOST}/${(claims.tid as string) ?? TID}/v2.0`)
    .setAudience((claims.aud as string) ?? CLIENT_ID)
    .setExpirationTime(opts.exp ?? "10m");
  if (opts.iat !== undefined) jwt.setIssuedAt(opts.iat);
  else jwt.setIssuedAt();
  return jwt.sign(key);
}

beforeAll(async () => {
  await freshDatabase();
  const a = await generateKeyPair("RS256");
  const b = await generateKeyPair("RS256");
  signer = a.privateKey;
  otherSigner = b.privateKey;
  const pub = { ...(await exportJWK(a.publicKey)), kid: "test", alg: "RS256" };
  jwks = createLocalJWKSet({ keys: [pub] });
  await asSystem((tx) =>
    tx.query("insert into user_identities (user_id, tenant_id, object_id) values ($1, $2, $3)", [DEMO.users.contosoRequester, TID, OID]),
  );
});

beforeEach(() => {
  cfg();
  setJwksForTesting(jwks);
});
afterEach(() => setTokenFetchForTesting(undefined));

const allowAll = { isTenantAllowed: async () => true };

describe("ID token validation", () => {
  it("accepts a valid token", async () => {
    const id = await validateIdToken(await token({ nonce: "n1" }), { nonce: "n1", ...allowAll }, jwks);
    expect(id).toMatchObject({ tenantId: TID, objectId: OID });
  });

  it.each([
    ["wrong nonce", { nonce: "other" }, {}],
    ["wrong audience", { nonce: "n1", aud: "someone-else" }, {}],
    ["issuer for a different tenant", { nonce: "n1", iss: `${HOST}/00000000-0000-4000-8000-0000000000ff/v2.0` }, {}],
    ["non-Microsoft issuer", { nonce: "n1", iss: `https://evil.example/${TID}/v2.0` }, {}],
    ["v1 token", { nonce: "n1", ver: "1.0" }, {}],
    ["expired", { nonce: "n1" }, { exp: "-10m" }],
    ["issued long ago", { nonce: "n1" }, { iat: Math.floor(Date.now() / 1000) - 7200, exp: "10m" }],
    ["malformed oid", { nonce: "n1", oid: "not-a-guid" }, {}],
  ])("rejects %s", async (_n, claims, opts) => {
    await expect(validateIdToken(await token(claims, signer, opts), { nonce: "n1", ...allowAll }, jwks)).rejects.toThrow();
  });

  it("rejects a token signed by an unknown key", async () => {
    await expect(validateIdToken(await token({ nonce: "n1" }, otherSigner), { nonce: "n1", ...allowAll }, jwks)).rejects.toThrow();
  });

  it("rejects an alg=none token", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ tid: TID, oid: OID, nonce: "n1", aud: CLIENT_ID, iss: `${HOST}/${TID}/v2.0` })).toString("base64url");
    await expect(validateIdToken(`${header}.${body}.`, { nonce: "n1", ...allowAll }, jwks)).rejects.toThrow();
  });

  it("rejects a directory that is not approved", async () => {
    await expect(validateIdToken(await token({ nonce: "n1" }), { nonce: "n1", isTenantAllowed: async () => false }, jwks)).rejects.toThrow(
      /not approved/,
    );
  });
});

async function flow(claims: Record<string, unknown> = {}, invite?: string) {
  const start = await beginSignIn({ returnTo: "/portal/tickets", inviteToken: invite });
  const url = new URL(start.url);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("client_secret")).toBeNull();
  const state = url.searchParams.get("state")!;
  const nonce = url.searchParams.get("nonce")!;
  const idToken = await token({ nonce, ...claims });
  let tokenRequest: URLSearchParams | undefined;
  setTokenFetchForTesting(async (_u, init) => {
    tokenRequest = new URLSearchParams(String(init?.body));
    return new Response(JSON.stringify({ id_token: idToken }), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { state, binding: start.binding, getTokenRequest: () => tokenRequest };
}

describe("authorization code flow", () => {
  it("signs in a provisioned (tid, oid) and sends the PKCE verifier", async () => {
    const f = await flow();
    const r = await completeSignIn({ state: f.state, code: "abc", error: null, binding: f.binding });
    expect(r).toMatchObject({ ok: true, userId: DEMO.users.contosoRequester, returnTo: "/portal/tickets" });
    expect(f.getTokenRequest()?.get("code_verifier")).toMatch(/^[\w-]{43,}$/);
  });

  it("rejects replayed state", async () => {
    const f = await flow();
    await completeSignIn({ state: f.state, code: "abc", error: null, binding: f.binding });
    const again = await completeSignIn({ state: f.state, code: "abc", error: null, binding: f.binding });
    expect(again).toEqual({ ok: false, reason: "invalid_request" });
  });

  it("rejects a callback from a different browser (binding cookie mismatch)", async () => {
    const f = await flow();
    const r = await completeSignIn({ state: f.state, code: "abc", error: null, binding: "attacker-binding" });
    expect(r).toEqual({ ok: false, reason: "invalid_request" });
  });

  it("rejects unknown state and expired auth requests", async () => {
    expect(await completeSignIn({ state: "nope", code: "abc", error: null, binding: "x" })).toEqual({ ok: false, reason: "invalid_request" });
    const f = await flow();
    await asSystem((tx) => tx.query("update auth_requests set expires_at = now() - interval '1 minute'"));
    expect(await completeSignIn({ state: f.state, code: "abc", error: null, binding: f.binding })).toEqual({ ok: false, reason: "invalid_request" });
  });

  it("rejects a token whose nonce does not match the request", async () => {
    const f = await flow({ nonce: "forged" });
    expect(await completeSignIn({ state: f.state, code: "abc", error: null, binding: f.binding })).toEqual({ ok: false, reason: "token_rejected" });
  });

  it("does not sign in an unprovisioned identity, even from an approved directory with a matching email", async () => {
    const f = await flow({ oid: "99999999-0000-4000-8000-0000000000aa", email: "riley.rivera@example.com" });
    expect(await completeSignIn({ state: f.state, code: "abc", error: null, binding: f.binding })).toEqual({ ok: false, reason: "not_provisioned" });
  });

  it("rejects sign-in from an unapproved directory", async () => {
    const f = await flow({ tid: "00000000-0000-4000-8000-0000000000ee" });
    expect(await completeSignIn({ state: f.state, code: "abc", error: null, binding: f.binding })).toEqual({ ok: false, reason: "token_rejected" });
  });

  it("refuses users with no active membership", async () => {
    const oid = "99999999-0000-4000-8000-0000000000bb";
    await asSystem(async (tx) => {
      const u = await tx.query<{ id: string }>("insert into users (email, display_name) values ('nobody@example.com', 'No Access') returning id");
      await tx.query("insert into user_identities (user_id, tenant_id, object_id) values ($1, $2, $3)", [u.rows[0].id, TID, oid]);
    });
    const f = await flow({ oid });
    expect(await completeSignIn({ state: f.state, code: "abc", error: null, binding: f.binding })).toEqual({ ok: false, reason: "no_access" });
  });

  it("accepts an invitation only from the invited directory", async () => {
    const { grantMembership } = await import("@/lib/admin/service");
    const { loadPrincipal } = await import("@/lib/authz");
    const op = (await asSystem((tx) => loadPrincipal(tx, DEMO.users.operator)))!;
    const g = await grantMembership(op, DEMO.customers.contoso, {
      email: "new.person@example.com",
      displayName: "New Person (Demo)",
      role: "requester",
      tenantId: TID,
    });
    const invite = new URL(g.invitation!.url).searchParams.get("invite")!;
    // Wrong directory: rejected (and the invitation stays unused).
    const wrong = await flow({ tid: DEMO.directories.fabrikam, oid: "99999999-0000-4000-8000-0000000000cc" }, invite);
    expect(await completeSignIn({ state: wrong.state, code: "abc", error: null, binding: wrong.binding })).toEqual({ ok: false, reason: "not_provisioned" });
    const right = await flow({ oid: "99999999-0000-4000-8000-0000000000cc" }, invite);
    const r = await completeSignIn({ state: right.state, code: "abc", error: null, binding: right.binding });
    expect(r).toMatchObject({ ok: true, userId: g.userId });
    // One-time: a second use fails.
    const replay = await flow({ oid: "99999999-0000-4000-8000-0000000000dd" }, invite);
    expect(await completeSignIn({ state: replay.state, code: "abc", error: null, binding: replay.binding })).toEqual({ ok: false, reason: "not_provisioned" });
  });

  it("only accepts relative return paths", () => {
    expect(safeReturnTo("https://evil.example")).toBe("/portal");
    expect(safeReturnTo("//evil.example")).toBe("/portal");
    expect(safeReturnTo("/\\evil.example")).toBe("/portal");
    expect(safeReturnTo("/portal/tickets/1")).toBe("/portal/tickets/1");
  });
});

describe("sessions", () => {
  it("expires idle and absolute sessions and honours revocation", async () => {
    const s = await createSession(DEMO.users.contosoAdmin, "demo");
    expect(await readSession(s.token)).not.toBeNull();
    await asSystem((tx) => tx.query("update sessions set last_seen_at = now() - interval '3 hours' where user_id = $1", [DEMO.users.contosoAdmin]));
    expect(await readSession(s.token)).toBeNull();

    const s2 = await createSession(DEMO.users.contosoAdmin, "demo");
    await asSystem((tx) => tx.query("update sessions set expires_at = now() - interval '1 second' where user_id = $1", [DEMO.users.contosoAdmin]));
    expect(await readSession(s2.token)).toBeNull();

    const s3 = await createSession(DEMO.users.contosoAdmin, "demo");
    await revokeSession(s3.token);
    expect(await readSession(s3.token)).toBeNull();
  });

  it("rejects sessions of disabled users", async () => {
    const s = await createSession(DEMO.users.fabrikamRequester, "demo");
    await asSystem((tx) => tx.query("update users set status = 'disabled' where id = $1", [DEMO.users.fabrikamRequester]));
    expect(await readSession(s.token)).toBeNull();
    await asSystem((tx) => tx.query("update users set status = 'active' where id = $1", [DEMO.users.fabrikamRequester]));
  });

  it("demo sessions stop working when demo mode is off", async () => {
    const s = await createSession(DEMO.users.contosoAdmin, "demo");
    cfg({ demoMode: false });
    expect(await readSession(s.token)).toBeNull();
  });

  it("stores only a hash of the session token", async () => {
    const s = await createSession(DEMO.users.contosoAdmin, "demo");
    const r = await asSystem((tx) => tx.query("select count(*)::int as n from sessions where id_hash = $1", [s.token]));
    expect(r.rows[0].n).toBe(0);
  });
});

function req(path: string, init: { method?: string; cookie?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", `itc_session=${init.cookie}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
const noParams = { params: Promise.resolve({}) };

describe("API guards", () => {
  it("requires a session", async () => {
    const r = await meGET(req("/api/me"), noParams);
    expect(r.status).toBe(401);
  });

  it("requires CSRF token and same origin for mutations", async () => {
    const s = await createSession(DEMO.users.contosoRequester, "demo");
    const body = { title: "CSRF check", description: "x", priority: "low", category: "other" };
    const noToken = await ticketsPOST(req("/api/tickets", { method: "POST", cookie: s.token, body, headers: { origin: "http://localhost:3000", "idempotency-key": "k-12345678" } }), noParams);
    expect(noToken.status).toBe(403);
    const badOrigin = await ticketsPOST(
      req("/api/tickets", { method: "POST", cookie: s.token, body, headers: { origin: "https://evil.example", "x-csrf-token": s.csrf, "idempotency-key": "k-12345678" } }),
      noParams,
    );
    expect(badOrigin.status).toBe(403);
    const crossSite = await ticketsPOST(
      req("/api/tickets", {
        method: "POST",
        cookie: s.token,
        body,
        headers: { origin: "http://localhost:3000", "sec-fetch-site": "cross-site", "x-csrf-token": s.csrf, "idempotency-key": "k-12345678" },
      }),
      noParams,
    );
    expect(crossSite.status).toBe(403);
    const ok = await ticketsPOST(
      req("/api/tickets", { method: "POST", cookie: s.token, body, headers: { origin: "http://localhost:3000", "x-csrf-token": s.csrf, "idempotency-key": "k-12345678" } }),
      noParams,
    );
    expect(ok.status).toBe(201);
    const denied = await asSystem((tx) => tx.query("select count(*)::int as n from audit_events where action = 'api.access' and outcome = 'denied'"));
    expect(denied.rows[0].n).toBeGreaterThanOrEqual(3);
  });

  it("returns field errors for invalid input", async () => {
    const s = await createSession(DEMO.users.contosoRequester, "demo");
    const r = await ticketsPOST(
      req("/api/tickets", {
        method: "POST",
        cookie: s.token,
        body: { title: "", priority: "nope" },
        headers: { origin: "http://localhost:3000", "x-csrf-token": s.csrf, "idempotency-key": "k-abcdefgh" },
      }),
      noParams,
    );
    expect(r.status).toBe(422);
    const j = await r.json();
    expect(j.error.fields.map((f: { path: string }) => f.path)).toEqual(expect.arrayContaining(["title", "priority"]));
  });
});
