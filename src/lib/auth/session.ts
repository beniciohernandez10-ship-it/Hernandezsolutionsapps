import { asSystem } from "../db";
import { config, secureCookies } from "../config";
import { randomToken, sha256 } from "./crypto";

export interface SessionRecord {
  userId: string;
  csrfToken: string;
  authTime: Date;
  method: "entra" | "demo";
  expiresAt: Date;
}

/** Host-only cookie: no Domain attribute, so it is never sent to the public website. */
export function sessionCookieName() {
  return secureCookies() ? "__Host-itc_session" : "itc_session";
}

export function sessionCookieOptions(maxAgeSeconds?: number) {
  return {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax" as const,
    path: "/",
    ...(maxAgeSeconds !== undefined ? { maxAge: maxAgeSeconds } : {}),
  };
}

export async function createSession(
  userId: string,
  method: "entra" | "demo",
  identity: { tenantId?: string; objectId?: string; authTime?: Date } = {},
) {
  const token = randomToken(32);
  const csrf = randomToken(32);
  const hours = config().sessionAbsoluteHours;
  const expiresAt = new Date(Date.now() + hours * 3600_000);
  await asSystem((tx) =>
    tx.query(
      `insert into sessions (id_hash, user_id, csrf_token, tenant_id, object_id, method, auth_time, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [sha256(token), userId, csrf, identity.tenantId ?? null, identity.objectId ?? null, method, identity.authTime ?? new Date(), expiresAt],
    ),
  );
  return { token, csrf, expiresAt, maxAge: hours * 3600 };
}

/**
 * Resolves a session token. Fails closed on expiry (absolute or idle),
 * revocation, or a disabled user.
 */
export async function readSession(token: string | undefined | null): Promise<SessionRecord | null> {
  if (!token || token.length > 200) return null;
  const idHash = sha256(token);
  return asSystem(async (tx) => {
    const r = await tx.query<{
      user_id: string;
      csrf_token: string;
      auth_time: string;
      method: "entra" | "demo";
      expires_at: string;
      last_seen_at: string;
    }>(
      `select s.user_id, s.csrf_token, s.auth_time, s.method, s.expires_at, s.last_seen_at
         from sessions s join users u on u.id = s.user_id
        where s.id_hash = $1 and s.revoked_at is null and u.status = 'active'
          and s.expires_at > now()
          and s.last_seen_at > now() - make_interval(mins => $2)`,
      [idHash, config().sessionIdleMinutes],
    );
    const s = r.rows[0];
    if (!s) return null;
    if (s.method === "demo" && !config().demoMode) return null;
    if (Date.now() - new Date(s.last_seen_at).getTime() > 60_000) {
      await tx.query("update sessions set last_seen_at = now() where id_hash = $1", [idHash]);
    }
    return {
      userId: s.user_id,
      csrfToken: s.csrf_token,
      authTime: new Date(s.auth_time),
      method: s.method,
      expiresAt: new Date(s.expires_at),
    };
  });
}

export async function revokeSession(token: string) {
  await asSystem((tx) =>
    tx.query("update sessions set revoked_at = now() where id_hash = $1 and revoked_at is null", [sha256(token)]),
  );
}

export async function revokeAllSessionsForUser(userId: string) {
  await asSystem((tx) => tx.query("update sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [userId]));
}

/** Housekeeping, run from the job runner. */
export async function purgeExpiredAuthState() {
  await asSystem(async (tx) => {
    await tx.query("delete from sessions where expires_at < now() - interval '7 days' or revoked_at < now() - interval '7 days'");
    await tx.query("delete from auth_requests where expires_at < now()");
    await tx.query("delete from rate_limits where window_start < now() - interval '1 day'");
    await tx.query("delete from idempotency_keys where created_at < now() - interval '7 days'");
  });
}
