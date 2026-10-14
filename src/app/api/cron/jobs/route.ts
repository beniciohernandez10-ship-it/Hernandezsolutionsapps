import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { safeEqual } from "@/lib/auth/crypto";
import { cronTick } from "@/lib/jobs";
import { log, errorSummary } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel Cron entry point. Vercel sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: NextRequest) {
  const secret = config().cronSecret;
  if (!secret || !safeEqual(req.headers.get("authorization"), `Bearer ${secret}`)) {
    return NextResponse.json({ error: { code: "unauthenticated" } }, { status: 401 });
  }
  try {
    return NextResponse.json(await cronTick(), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    log.error("cron.failed", { error: errorSummary(err) });
    return NextResponse.json({ error: { code: "internal" } }, { status: 500 });
  }
}
