import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Liveness + database reachability. Reveals no configuration details.
 * `?probe=db` also times five sequential round trips to the database (ms),
 * which shows whether the functions and the database share a region.
 */
export async function GET(req: NextRequest) {
  try {
    const database = await db();
    await database.query("select 1");
    const body: Record<string, unknown> = { status: "ok", database: "ok" };
    if (req.nextUrl.searchParams.get("probe") === "db") {
      const rtt: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t = performance.now();
        await database.query("select 1");
        rtt.push(Math.round((performance.now() - t) * 10) / 10);
      }
      body.dbRoundTripMs = rtt;
    }
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
