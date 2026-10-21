import { NextResponse } from "next/server";
import { api, readJson } from "@/lib/http/api";
import { submitRequest } from "@/lib/catalog/service";
import { drainAfterResponse } from "@/lib/http/after-response";

export const dynamic = "force-dynamic";

export const POST = api(
  async ({ req, principal, params }) => {
    const r = await submitRequest(principal, params.id, await readJson(req), req.headers.get("idempotency-key") ?? "");
    drainAfterResponse();
    return NextResponse.json(r, { status: r.replayed ? 200 : 201, headers: { "cache-control": "no-store" } });
  },
  { rate: [20, 300] },
);
