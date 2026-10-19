import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "../db";
import { randomToken, sha256 } from "../crypto";
import { getSetting } from "../settings";
import { hasRole, type RoleKey } from "./roles";

export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-hs_crm" : "hs_crm";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: RoleKey;
  mfaEnabled: boolean;
  dailyCallGoal: number;
  sessionId: string;
  mfaVerified: boolean;
}

export async function createSession(userId: string, mfaVerified: boolean): Promise<void> {
  const token = randomToken(32);
  const { sessionHours } = await getSetting("security");
  const h = await headers();
  const expiresAt = new Date(Date.now() + sessionHours * 3600_000);
  await db.session.create({
    data: {
      id: sha256(token),
      userId,
      mfaVerified,
      expiresAt,
      ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { id: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { id: sha256(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  const u = session.user;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as RoleKey,
    mfaEnabled: u.mfaEnabled,
    dailyCallGoal: u.dailyCallGoal,
    sessionId: session.id,
    mfaVerified: session.mfaVerified,
  };
});

/**
 * Server-side gate for every page, action and route.
 * Sends people to sign in, to finish MFA, or to set MFA up when the workspace requires it.
 */
export async function requireUser(min: RoleKey = "VIEWER", opts: { allowMfaSetup?: boolean } = {}): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mfaEnabled && !user.mfaVerified) redirect("/login/mfa");
  if (!user.mfaEnabled && !opts.allowMfaSetup) {
    const { requireMfa } = await getSetting("security");
    if (requireMfa) redirect("/account?setup=mfa");
  }
  if (!hasRole(user.role, min)) redirect("/?denied=1");
  return user;
}

/** Same checks as requireUser, for server actions: throws instead of redirecting on role failures. */
export async function requireActionUser(min: RoleKey = "SALES"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || (user.mfaEnabled && !user.mfaVerified)) throw new ActionError("Your session ended. Sign in again.");
  if (!user.mfaEnabled) {
    const { requireMfa } = await getSetting("security");
    if (requireMfa) throw new ActionError("Set up two-step sign-in first (Account page).");
  }
  if (!hasRole(user.role, min)) throw new ActionError("Your role doesn't allow this.");
  return user;
}

export class ActionError extends Error {}

/** For route handlers: the user, or a JSON error response to return as-is. */
export async function routeUser(min: RoleKey = "VIEWER"): Promise<CurrentUser | Response> {
  try {
    return await requireActionUser(min);
  } catch (err) {
    const message = err instanceof ActionError ? err.message : "Sign in required";
    return Response.json({ error: message }, { status: /role/i.test(message) ? 403 : 401 });
  }
}
