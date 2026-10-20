import { NextResponse } from "next/server";
import { api, readJson } from "@/lib/http/api";
import { addMessage } from "@/lib/tickets/service";
import { drainAfterResponse } from "@/lib/http/after-response";

export const dynamic = "force-dynamic";

export const POST = api(
  async ({ req, principal, params }) => {
    const r = await addMessage(principal, params.id, await readJson(req));
    drainAfterResponse();
    return NextResponse.json(r, { status: 201, headers: { "cache-control": "no-store" } });
  },
  { rate: [30, 60] },
);
