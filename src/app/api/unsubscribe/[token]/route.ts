import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { applyUnsubscribe, UNSUBSCRIBE_ACTIONS, type UnsubscribeAction } from "@/lib/notify/unsubscribe";
import { shipAuditAfterResponse } from "@/lib/audit/store";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/http/ip";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

const page = (token: string, query = "") => new URL(`/unsubscribe/${encodeURIComponent(token)}${query}`, config().appOrigin);

/** Opening the link only shows the confirmation page; nothing changes on GET (link scanners prefetch). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  return NextResponse.redirect(page((await params).token), 303);
}

/**
 * One-click unsubscribe. Not a user route: the token in the URL is the only
 * credential, so there's no session or CSRF check. Mail apps send
 * "List-Unsubscribe=One-Click" (RFC 8058); the confirmation page's form sends
 * an action and is redirected back to the page.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { token } = await params;
  try {
    await rateLimit(`unsubscribe:${clientIp(req)}`, 30, 60);
  } catch (err) {
    if (err instanceof AppError) return new NextResponse(null, { status: err.status });
    throw err;
  }
  if (Number(req.headers.get("content-length") ?? 0) > 4096) return new NextResponse(null, { status: 413 });
  const form = new URLSearchParams((await req.text()).slice(0, 4096));
  const requested = form.get("action");
  const fromPage = requested !== null;
  const action: UnsubscribeAction | null = fromPage
    ? (UNSUBSCRIBE_ACTIONS as readonly string[]).includes(requested) ? (requested as UnsubscribeAction) : null
    : form.get("List-Unsubscribe") === "One-Click" ? "category" : null;
  if (!action) return fromPage ? NextResponse.redirect(page(token), 303) : new NextResponse(null, { status: 400 });

  shipAuditAfterResponse();
  const done = await applyUnsubscribe(token, action);
  if (fromPage) return NextResponse.redirect(page(token, done ? `?done=${action}` : ""), 303);
  return new NextResponse(null, { status: done ? 200 : 404, headers: { "cache-control": "no-store" } });
}
