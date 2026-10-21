import { NextResponse } from "next/server";
import { api, readJson } from "@/lib/http/api";
import { declareIncident, listIncidents } from "@/lib/incidents/service";
import { drainAfterResponse } from "@/lib/http/after-response";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal }) => listIncidents(principal));
export const POST = api(
  async ({ req, principal }) => {
    const r = await declareIncident(principal, await readJson(req));
    drainAfterResponse();
    return NextResponse.json(r, { status: 201, headers: { "cache-control": "no-store" } });
  },
  { rate: [20, 60] },
);
