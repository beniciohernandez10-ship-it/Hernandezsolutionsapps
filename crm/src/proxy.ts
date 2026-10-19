import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/login", "/setup", "/api/cron/", "/api/calendar/", "/api/health", "/_next/", "/favicon", "/icon", "/manifest"];
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-hs_crm" : "hs_crm";

/**
 * Security headers with a per-request CSP nonce, optional host allow-list, and a fast
 * redirect to sign-in when there is no session cookie. Real authorization happens server-side
 * in every page, action and route (see src/lib/auth/session.ts).
 */
export function proxy(request: NextRequest) {
  const allowed = (process.env.ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  const host = (request.headers.get("host") ?? "").toLowerCase();
  if (allowed.length && !allowed.includes(host)) return new NextResponse("Misdirected request", { status: 421 });

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isPublic && !request.cookies.get(COOKIE)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const https = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Charts and drag-and-drop set inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (https) response.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains");
  return response;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
