import { NextResponse } from "next/server";
import { api, readJson } from "@/lib/http/api";
import { listArticles, saveArticle } from "@/lib/kb/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ req, principal }) => ({ items: await listArticles(principal, Object.fromEntries(req.nextUrl.searchParams.entries())) }));

export const POST = api(
  async ({ req, principal }) => NextResponse.json(await saveArticle(principal, null, await readJson(req)), { status: 201, headers: { "cache-control": "no-store" } }),
  { rate: [30, 60] },
);
