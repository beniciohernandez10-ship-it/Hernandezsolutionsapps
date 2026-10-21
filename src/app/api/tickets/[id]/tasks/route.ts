import { NextResponse } from "next/server";
import { api, readJson } from "@/lib/http/api";
import { addTask } from "@/lib/catalog/service";

export const dynamic = "force-dynamic";

export const POST = api(
  async ({ req, principal, params }) => NextResponse.json(await addTask(principal, params.id, await readJson(req)), { status: 201, headers: { "cache-control": "no-store" } }),
  { rate: [60, 60] },
);
