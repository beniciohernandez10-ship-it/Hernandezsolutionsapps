import { NextResponse } from "next/server";
import { api, readJson } from "@/lib/http/api";
import { createChange, listChanges } from "@/lib/changes/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ req, principal }) => ({ items: await listChanges(principal, Object.fromEntries(req.nextUrl.searchParams.entries())) }));
export const POST = api(async ({ req, principal }) => NextResponse.json(await createChange(principal, await readJson(req)), { status: 201, headers: { "cache-control": "no-store" } }), {
  rate: [20, 60],
});
