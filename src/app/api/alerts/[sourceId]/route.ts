import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { ingestAlert } from "@/lib/monitoring/service";
import { drainAfterResponse } from "@/lib/http/after-response";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/http/ip";
import { AppError } from "@/lib/errors";
import { log, errorSummary } from "@/lib/log";

export const dynamic = "force-dynamic";

const MAX_BODY = 64 * 1024;

/**
 * Alerts from external monitoring tools. Not a user route: the source's token
 * (Authorization: Bearer <token>, or X-Alert-Token) authenticates it. See
 * docs/monitoring-alerts.md for the payload.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : (req.headers.get("x-alert-token")?.trim() ?? null);
  try {
    await rateLimit(`alerts:${clientIp(req)}`, 120, 60);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) throw new AppError(413, "bad_request", "Alert is too large.");
    const raw = await req.text();
    if (raw.length > MAX_BODY) throw new AppError(413, "bad_request", "Alert is too large.");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new AppError(400, "bad_request", "Send the alert as JSON.");
    }
    const r = await ingestAlert(sourceId, token, body);
    drainAfterResponse();
    return NextResponse.json({ ok: true, ...r }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ ok: false, error: "validation_failed", fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 422 });
    }
    if (err instanceof AppError) return NextResponse.json({ ok: false, error: err.code, message: err.message }, { status: err.status });
    log.error("alerts.ingest_failed", { error: errorSummary(err) });
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
