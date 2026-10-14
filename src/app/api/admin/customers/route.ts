import { NextResponse } from "next/server";
import { api, readJson } from "@/lib/http/api";
import { createCustomer, listCustomersForOperator } from "@/lib/admin/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal }) => ({ customers: await listCustomersForOperator(principal) }));

export const POST = api(
  async ({ req, principal }) =>
    NextResponse.json(await createCustomer(principal, await readJson(req)), { status: 201, headers: { "cache-control": "no-store" } }),
  { recentAuth: true },
);
