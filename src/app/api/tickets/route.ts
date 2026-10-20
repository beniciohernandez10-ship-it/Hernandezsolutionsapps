import { NextResponse } from "next/server";
import { api, readJson } from "@/lib/http/api";
import { createTicket, listTickets } from "@/lib/tickets/service";
import { drainAfterResponse } from "@/lib/http/after-response";

export const dynamic = "force-dynamic";

export const GET = api(async ({ req, principal }) => {
  const sp = req.nextUrl.searchParams;
  return listTickets(principal, Object.fromEntries(sp.entries()));
});

export const POST = api(
  async ({ req, principal }) => {
    const body = await readJson(req);
    const result = await createTicket(principal, body, req.headers.get("idempotency-key") ?? "");
    drainAfterResponse();
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers: { "cache-control": "no-store" } });
  },
  { rate: [20, 300] },
);
