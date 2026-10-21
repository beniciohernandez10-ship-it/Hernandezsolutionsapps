import { api, readJson } from "@/lib/http/api";
import { listCatalogForOperator, saveCatalogItem } from "@/lib/catalog/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal }) => ({ items: await listCatalogForOperator(principal) }));
export const POST = api(async ({ req, principal }) => saveCatalogItem(principal, null, await readJson(req)), { recentAuth: true });
