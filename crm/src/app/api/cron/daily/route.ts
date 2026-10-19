import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { safeEqual } from "@/lib/crypto";
import { runDailyJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Called by Vercel Cron with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runDailyJobs();
  await audit(null, "cron.daily", undefined, result as unknown as Record<string, unknown>);
  return NextResponse.json({ ok: true, ...result });
}
