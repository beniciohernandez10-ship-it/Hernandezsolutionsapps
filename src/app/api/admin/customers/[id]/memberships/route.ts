import { NextResponse } from "next/server";
import { api, readJson } from "@/lib/http/api";
import { grantMembership, listMembershipsForOperator } from "@/lib/admin/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal, params }) => ({ memberships: await listMembershipsForOperator(principal, params.id) }));

export const POST = api(
  async ({ req, principal, params }) =>
    NextResponse.json(await grantMembership(principal, params.id, await readJson(req)), { status: 201, headers: { "cache-control": "no-store" } }),
  { recentAuth: true, rate: [30, 300] },
);
