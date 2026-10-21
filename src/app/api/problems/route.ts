import { NextResponse } from "next/server";
import { api, readJson } from "@/lib/http/api";
import { createProblem, listProblems } from "@/lib/problems/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ req, principal }) => ({ items: await listProblems(principal, { open: req.nextUrl.searchParams.get("open") === "1" }) }));
export const POST = api(async ({ req, principal }) => NextResponse.json(await createProblem(principal, await readJson(req)), { status: 201, headers: { "cache-control": "no-store" } }), {
  rate: [20, 60],
});
