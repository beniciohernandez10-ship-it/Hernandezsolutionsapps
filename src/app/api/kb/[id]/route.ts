import { api, readJson } from "@/lib/http/api";
import { getArticle, saveArticle } from "@/lib/kb/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal, params }) => getArticle(principal, params.id));
export const PUT = api(async ({ req, principal, params }) => saveArticle(principal, params.id, await readJson(req)), { rate: [30, 60] });
