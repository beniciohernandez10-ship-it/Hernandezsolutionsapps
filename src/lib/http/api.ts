import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { loadPrincipal, type Principal } from "../authz";
import { asSystem } from "../db";
import { AppError } from "../errors";
import { config } from "../config";
import { log, errorSummary } from "../log";
import { readSession, sessionCookieName, type SessionRecord } from "../auth/session";
import { safeEqual } from "../auth/crypto";
import { rateLimit } from "../ratelimit";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Same-origin check for state-changing requests. Browsers always send Origin
 * on cross-origin and on same-origin POST/PATCH/DELETE fetches.
 */
export function checkOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  return origin === config().appOrigin;
}

export interface ApiContext {
  req: NextRequest;
  principal: Principal;
  session: SessionRecord;
  requestId: string;
  params: Record<string, string>;
}

interface Options {
  /** Rate limit per user: [limit, windowSeconds]. */
  rate?: [number, number];
  /** Require a recent interactive sign-in (minutes from config). */
  recentAuth?: boolean;
}

export function jsonError(err: unknown, requestId: string) {
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation_failed",
          message: "Please check the highlighted fields.",
          fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        requestId,
      },
      { status: 422, headers: { "cache-control": "no-store" } },
    );
  }
  if (err instanceof AppError) {
    const headers: Record<string, string> = { "cache-control": "no-store" };
    if (err.code === "rate_limited" && err.details?.retryAfter) headers["retry-after"] = String(err.details.retryAfter);
    return NextResponse.json({ error: { code: err.code, message: err.message, ...err.details }, requestId }, { status: err.status, headers });
  }
  log.error("api.unhandled", { requestId, error: errorSummary(err) });
  return NextResponse.json(
    { error: { code: "internal", message: "Something went wrong. Please try again." }, requestId },
    { status: 500, headers: { "cache-control": "no-store" } },
  );
}

async function recordDenial(principal: Principal | null, req: NextRequest, err: AppError, requestId: string) {
  log.warn("authz.denied", { requestId, userId: principal?.userId, path: req.nextUrl.pathname, method: req.method, code: err.code });
  try {
    await asSystem((tx) =>
      tx.query(
        "insert into audit_events (actor_user_id, action, outcome, target_type, target_id, details, request_id) values ($1, 'api.access', 'denied', 'route', $2, $3, $4)",
        [principal?.userId ?? null, `${req.method} ${req.nextUrl.pathname}`.slice(0, 200), JSON.stringify({ code: err.code }), requestId],
      ),
    );
  } catch (e) {
    log.error("audit.write_failed", { requestId, error: errorSummary(e) });
  }
}

type Handler = (ctx: ApiContext) => Promise<Response | object>;

/**
 * Wraps an authenticated API route: session lookup, principal load (fresh from
 * the database), CSRF + origin checks on mutations, rate limiting, error
 * mapping and no-store caching.
 */
export function api(handler: Handler, opts: Options = {}) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
    const requestId = randomUUID();
    let principal: Principal | null = null;
    try {
      const token = req.cookies.get(sessionCookieName())?.value;
      const session = await readSession(token);
      if (!session) throw new AppError(401, "unauthenticated", "Your session has ended. Please sign in again.");
      principal = await asSystem((tx) => loadPrincipal(tx, session.userId));
      if (!principal) throw new AppError(401, "unauthenticated", "Your session has ended. Please sign in again.");
      principal.sessionAuthTime = session.authTime;

      if (MUTATING.has(req.method)) {
        if (!checkOrigin(req)) throw new AppError(403, "csrf_failed", "This request did not come from the portal.");
        if (!safeEqual(req.headers.get("x-csrf-token"), session.csrfToken)) {
          throw new AppError(403, "csrf_failed", "Your page is out of date. Reload and try again.");
        }
      }
      if (opts.recentAuth && session.method === "entra" && Date.now() - session.authTime.getTime() > config().reauthMinutes * 60_000) {
        throw new AppError(401, "reauth_required", "Please sign in again to confirm this change.");
      }
      if (opts.rate) await rateLimit(`user:${principal.userId}:${req.nextUrl.pathname}`, opts.rate[0], opts.rate[1]);

      const out = await handler({ req, principal, session, requestId, params: await ctx.params });
      if (out instanceof Response) return out;
      return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
    } catch (err) {
      if (err instanceof AppError && (err.status === 403 || err.status === 404)) await recordDenial(principal, req, err, requestId);
      return jsonError(err, requestId);
    }
  };
}

export async function readJson(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("application/json")) throw new AppError(415 as number, "bad_request", "Expected a JSON request body.");
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 256 * 1024) throw new AppError(413, "bad_request", "Request body is too large.");
  try {
    return await req.json();
  } catch {
    throw new AppError(400, "bad_request", "Request body is not valid JSON.");
  }
}
