import { NextResponse, type NextRequest } from "next/server";
import { config, emailIntakeEnabled } from "@/lib/config";
import { recordInboundWebhook, verifySvixSignature } from "@/lib/email/inbound";
import { drainAfterResponse } from "@/lib/http/after-response";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/http/ip";
import { AppError } from "@/lib/errors";
import { log, errorSummary } from "@/lib/log";

export const dynamic = "force-dynamic";

const MAX_BODY = 256 * 1024;

/** Resend "email.received" webhook. Not a user route: authenticated by its signature alone. */
export async function POST(req: NextRequest) {
  const secret = config().email.webhookSecret;
  if (!emailIntakeEnabled() || !secret) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  try {
    await rateLimit(`inbound:${clientIp(req)}`, 120, 60);
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json({ error: { code: err.code } }, { status: err.status });
    throw err;
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return NextResponse.json({ error: { code: "too_large" } }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: { code: "too_large" } }, { status: 413 });
  const signed = verifySvixSignature(
    raw,
    { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") },
    secret,
  );
  if (!signed) {
    log.warn("inbound.bad_signature", {});
    return NextResponse.json({ error: { code: "unauthenticated" } }, { status: 401 });
  }
  try {
    const r = await recordInboundWebhook(raw);
    if (r.queued) drainAfterResponse();
    return NextResponse.json({ received: true });
  } catch (err) {
    log.error("inbound.record_failed", { error: errorSummary(err) });
    return NextResponse.json({ error: { code: "bad_request" } }, { status: 400 });
  }
}
