import { api, readJson } from "@/lib/http/api";
import { saveCatalogItem } from "@/lib/catalog/service";

export const dynamic = "force-dynamic";

export const PUT = api(async ({ req, principal, params }) => saveCatalogItem(principal, params.id, await readJson(req)), { recentAuth: true });
