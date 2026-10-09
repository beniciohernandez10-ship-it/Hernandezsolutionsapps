import { NextResponse, type NextRequest } from "next/server";
import { readSession, revokeSession, sessionCookieName, sessionCookieOptions } from "@/lib/auth/session";
import { safeEqual } from "@/lib/auth/crypto";
import { checkOrigin } from "@/lib/http/api";
import { auditAuth, entraConfigured, signOutUrl } from "@/lib/auth/entra";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(sessionCookieName())?.value;
  const session = await readSession(token);
  if (!checkOrigin(req) || (session && !safeEqual(req.headers.get("x-csrf-token"), session.csrfToken))) {
    return NextResponse.json({ error: { code: "csrf_failed", message: "Reload the page and try again." } }, { status: 403 });
  }
  if (token) await revokeSession(token);
  if (session) await auditAuth(session.userId, "auth.signout", "success", { method: session.method });
  const signedOut = `${config().appOrigin}/signed-out`;
  const redirect = session?.method === "entra" && entraConfigured() ? signOutUrl(signedOut) : "/signed-out";
  const res = NextResponse.json({ redirect }, { headers: { "cache-control": "no-store" } });
  res.cookies.set(sessionCookieName(), "", sessionCookieOptions(0));
  // Drop any cached portal assets and storage this origin holds in the browser.
  res.headers.set("clear-site-data", '"cache", "storage"');
  return res;
}
