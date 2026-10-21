import { NextResponse } from "next/server";
import { api, readJson } from "@/lib/http/api";
import { listCanned, saveCanned } from "@/lib/productivity/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ req, principal }) => ({ items: await listCanned(principal, req.nextUrl.searchParams.get("customerId") ?? undefined) }));
export const POST = api(async ({ req, principal }) => NextResponse.json(await saveCanned(principal, null, await readJson(req)), { status: 201, headers: { "cache-control": "no-store" } }), {
  rate: [30, 60],
});
