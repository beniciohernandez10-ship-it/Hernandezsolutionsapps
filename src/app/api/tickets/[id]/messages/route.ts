import { NextResponse } from "next/server";
import { api, readJson } from "@/lib/http/api";
import { addMessage } from "@/lib/tickets/service";

export const dynamic = "force-dynamic";

export const POST = api(
  async ({ req, principal, params }) =>
    NextResponse.json(await addMessage(principal, params.id, await readJson(req)), { status: 201, headers: { "cache-control": "no-store" } }),
  { rate: [30, 60] },
);
