import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { asSystem } from "../db";
import { config } from "../config";
import { AppError } from "../errors";
import { log } from "../log";
import { pkceChallenge, randomToken, safeEqual, sha256 } from "./crypto";

/**
 * Microsoft Entra ID sign-in: OAuth 2.0 authorization code flow with PKCE,
 * state and nonce, as a confidential web client. The client secret is only
 * read on the server and never reaches a browser, desktop or mobile bundle.
 *
 * Signature, audience, lifetime and nonce validation use `jose`. The issuer is
 * checked against the token's own `tid` (Entra multi-tenant pattern) and the
 * `tid` must be a directory an operator has approved. A valid token alone does
 * not grant access: the (tid, oid) pair must map to a provisioned user with an
 * active membership or operator authority.
 */

export const AUTH_BINDING_COOKIE = "itc_auth_binding";
const AUTH_REQUEST_TTL_MS = 10 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function entraConfigured() {
  const c = config().entra;
  return Boolean(c.clientId && c.clientSecret);
}

export function redirectUri() {
  return `${config().appOrigin}/api/auth/callback`;
}

/** Only same-site relative paths are accepted as post-login destinations. */
export function safeReturnTo(v: string | null | undefined) {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.includes("\\") || /[\u0000-\u001f]/.test(v)) return "/portal";
  return v.length > 512 ? "/portal" : v;
}

export async function beginSignIn(opts: { returnTo?: string | null; inviteToken?: string | null; prompt?: "login" | "select_account" }) {
  if (!entraConfigured()) throw new AppError(503, "not_configured", "Microsoft sign-in is not configured yet.");
  const c = config().entra;
  const state = randomToken(32);
  const nonce = randomToken(32);
  const verifier = randomToken(48);
  const binding = randomToken(32);
  await asSystem((tx) =>
    tx.query(
      `insert into auth_requests (state_hash, nonce, code_verifier, return_to, invite_token, expires_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        sha256(`${state}.${binding}`),
        nonce,
        verifier,
        safeReturnTo(opts.returnTo),
        opts.inviteToken ?? null,
        new Date(Date.now() + AUTH_REQUEST_TTL_MS),
      ],
    ),
  );
  const url = new URL(`${c.authorityHost}/${c.authorityTenant}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: c.clientId!,
    response_type: "code",
    redirect_uri: redirectUri(),
    response_mode: "query",
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    ...(opts.prompt ? { prompt: opts.prompt } : {}),
  }).toString();
  return { url: url.toString(), binding, bindingMaxAge: AUTH_REQUEST_TTL_MS / 1000 };
}

/** Single-use: the auth request row is deleted whether or not the callback succeeds. */
async function consumeAuthRequest(state: string, binding: string | undefined) {
  if (!state || !binding || state.length > 200 || binding.length > 200) return null;
  const r = await asSystem((tx) =>
    tx.query<{ nonce: string; code_verifier: string; return_to: string; invite_token: string | null; expires_at: string }>(
      "delete from auth_requests where state_hash = $1 returning nonce, code_verifier, return_to, invite_token, expires_at",
      [sha256(`${state}.${binding}`)],
    ),
  );
  const row = r.rows[0];
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

let jwks: JWTVerifyGetKey | undefined;
export function setJwksForTesting(k: JWTVerifyGetKey | undefined) {
  jwks = k;
}
function getJwks() {
  jwks ??= createRemoteJWKSet(new URL(`${config().entra.authorityHost}/common/discovery/v2.0/keys`), {
    timeoutDuration: 5000,
    cooldownDuration: 30_000,
  });
  return jwks;
}

export interface VerifiedIdentity {
  tenantId: string;
  objectId: string;
  name?: string;
  email?: string;
  authTime?: Date;
}

export class IdTokenError extends Error {}

/** Validates an Entra v2.0 ID token. Exported for direct testing. */
export async function validateIdToken(
  idToken: string,
  expected: { nonce: string; isTenantAllowed: (tid: string) => Promise<boolean> },
  keys: JWTVerifyGetKey = getJwks(),
): Promise<VerifiedIdentity> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, keys, {
      algorithms: ["RS256"],
      audience: config().entra.clientId,
      clockTolerance: 120,
      maxTokenAge: "1h",
      requiredClaims: ["iss", "aud", "exp", "iat", "tid", "oid", "nonce"],
    }));
  } catch (err) {
    throw new IdTokenError(`ID token rejected: ${(err as Error).name}`);
  }
  const tid = String(payload.tid ?? "");
  const oid = String(payload.oid ?? "");
  if (!UUID.test(tid) || !UUID.test(oid)) throw new IdTokenError("ID token has malformed tid/oid.");
  if (payload.iss !== `${config().entra.authorityHost}/${tid}/v2.0`) throw new IdTokenError("ID token issuer mismatch.");
  if (payload.ver !== undefined && payload.ver !== "2.0") throw new IdTokenError("Unexpected token version.");
  if (!safeEqual(String(payload.nonce), expected.nonce)) throw new IdTokenError("ID token nonce mismatch.");
  if (!(await expected.isTenantAllowed(tid.toLowerCase()))) throw new IdTokenError("Directory is not approved for sign-in.");
  return {
    tenantId: tid.toLowerCase(),
    objectId: oid.toLowerCase(),
    name: typeof payload.name === "string" ? payload.name : undefined,
    email: typeof payload.email === "string" ? payload.email : typeof payload.preferred_username === "string" ? payload.preferred_username : undefined,
    authTime: typeof payload.iat === "number" ? new Date(payload.iat * 1000) : undefined,
  };
}

export async function isTenantApproved(tid: string) {
  const r = await asSystem((tx) =>
    tx.query("select 1 from entra_directories where tenant_id = $1 and sign_in_enabled", [tid]),
  );
  return r.rows.length > 0;
}

type FetchLike = typeof fetch;
let tokenFetch: FetchLike = (...a) => fetch(...a);
export function setTokenFetchForTesting(f: FetchLike | undefined) {
  tokenFetch = f ?? ((...a) => fetch(...a));
}

async function redeemCode(code: string, verifier: string) {
  const c = config().entra;
  const res = await tokenFetch(`${c.authorityHost}/${c.authorityTenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId!,
      client_secret: c.clientSecret!,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
      scope: "openid profile email",
    }),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (!res.ok) throw new IdTokenError(`Token endpoint returned ${res.status}.`);
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new IdTokenError("Token response did not include an ID token.");
  // Access/refresh tokens are not stored: the portal only needs the verified identity.
  return body.id_token;
}

export type SignInFailure = "invalid_request" | "token_rejected" | "not_provisioned" | "no_access" | "provider_error";

export async function completeSignIn(params: {
  state: string | null;
  code: string | null;
  error: string | null;
  binding: string | undefined;
}): Promise<{ ok: true; userId: string; identity: VerifiedIdentity; returnTo: string } | { ok: false; reason: SignInFailure }> {
  const req = await consumeAuthRequest(params.state ?? "", params.binding);
  if (!req) return { ok: false, reason: "invalid_request" };
  if (params.error || !params.code) {
    log.warn("auth.provider_error", { error: params.error?.slice(0, 60) });
    return { ok: false, reason: "provider_error" };
  }
  let identity: VerifiedIdentity;
  try {
    const idToken = await redeemCode(params.code, req.code_verifier);
    identity = await validateIdToken(idToken, { nonce: req.nonce, isTenantAllowed: isTenantApproved });
  } catch (err) {
    log.warn("auth.token_rejected", { reason: (err as Error).message });
    return { ok: false, reason: "token_rejected" };
  }

  const userId = await asSystem(async (tx) => {
    const found = await tx.query<{ user_id: string }>(
      `select i.user_id from user_identities i join users u on u.id = i.user_id
        where i.tenant_id = $1 and i.object_id = $2 and u.status = 'active'`,
      [identity.tenantId, identity.objectId],
    );
    if (found.rows[0]) return found.rows[0].user_id;
    if (!req.invite_token) return null;
    // Invitation: one-time code + sign-in from the invited directory. Email is never used for matching.
    const inv = await tx.query<{ id: string; user_id: string }>(
      `update invitations set accepted_at = now()
        where token_hash = $1 and accepted_at is null and expires_at > now() and tenant_id = $2
        returning id, user_id`,
      [sha256(req.invite_token), identity.tenantId],
    );
    if (!inv.rows[0]) return null;
    const already = await tx.query("select 1 from user_identities where user_id = $1 and tenant_id = $2", [
      inv.rows[0].user_id,
      identity.tenantId,
    ]);
    if (already.rows[0]) return null;
    await tx.query("insert into user_identities (user_id, tenant_id, object_id) values ($1, $2, $3)", [
      inv.rows[0].user_id,
      identity.tenantId,
      identity.objectId,
    ]);
    await tx.query(
      "insert into audit_events (actor_user_id, action, target_type, target_id) values ($1, 'invitation.accept', 'invitation', $2)",
      [inv.rows[0].user_id, inv.rows[0].id],
    );
    return inv.rows[0].user_id;
  });
  if (!userId) {
    await auditAuth(null, "auth.signin", "denied", { reason: "not_provisioned", tid: identity.tenantId });
    return { ok: false, reason: "not_provisioned" };
  }
  const access = await asSystem((tx) =>
    tx.query(
      `select 1 from users u where u.id = $1 and (u.is_platform_operator or exists (
         select 1 from memberships m join customers c on c.id = m.customer_id
          where m.user_id = u.id and m.revoked_at is null and c.status <> 'offboarded'))`,
      [userId],
    ),
  );
  if (!access.rows[0]) {
    await auditAuth(userId, "auth.signin", "denied", { reason: "no_access" });
    return { ok: false, reason: "no_access" };
  }
  await auditAuth(userId, "auth.signin", "success", { method: "entra", tid: identity.tenantId });
  return { ok: true, userId, identity, returnTo: req.return_to };
}

export async function auditAuth(userId: string | null, action: string, outcome: "success" | "denied" | "failure", details = {}) {
  await asSystem((tx) =>
    tx.query("insert into audit_events (actor_user_id, action, outcome, details) values ($1, $2, $3, $4)", [
      userId,
      action,
      outcome,
      JSON.stringify(details),
    ]),
  );
}

export function signOutUrl(postLogout: string) {
  const c = config().entra;
  const u = new URL(`${c.authorityHost}/common/oauth2/v2.0/logout`);
  u.searchParams.set("post_logout_redirect_uri", postLogout);
  return u.toString();
}
