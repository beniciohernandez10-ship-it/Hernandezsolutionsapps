import { NextResponse, type NextRequest } from "next/server";
import { AUTH_BINDING_COOKIE, completeSignIn } from "@/lib/auth/entra";
import { createSession, sessionCookieName, sessionCookieOptions } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { clientIp } from "@/lib/http/ip";
import { rateLimit } from "@/lib/ratelimit";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = config().appOrigin;
  try {
    await rateLimit(`callback:${clientIp(req)}`, 30, 300);
  } catch (err) {
    if (err instanceof AppError) return NextResponse.redirect(new URL("/signin?error=rate_limited", origin), 303);
    throw err;
  }
  const sp = req.nextUrl.searchParams;
  const result = await completeSignIn({
    state: sp.get("state"),
    code: sp.get("code"),
    error: sp.get("error"),
    binding: req.cookies.get(AUTH_BINDING_COOKIE)?.value,
  });
  if (!result.ok) {
    const res = NextResponse.redirect(new URL(`/signin?error=${result.reason}`, origin), 303);
    res.cookies.delete({ name: AUTH_BINDING_COOKIE, path: "/api/auth/callback" });
    return res;
  }
  const s = await createSession(result.userId, "entra", {
    tenantId: result.identity.tenantId,
    objectId: result.identity.objectId,
    authTime: result.identity.authTime,
  });
  const res = NextResponse.redirect(new URL(result.returnTo, origin), 303);
  res.cookies.set(sessionCookieName(), s.token, sessionCookieOptions(s.maxAge));
  res.cookies.delete({ name: AUTH_BINDING_COOKIE, path: "/api/auth/callback" });
  res.headers.set("cache-control", "no-store");
  return res;
}
