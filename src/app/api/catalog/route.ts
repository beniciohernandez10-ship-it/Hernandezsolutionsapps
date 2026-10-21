import { api } from "@/lib/http/api";
import { listCatalog } from "@/lib/catalog/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal }) => ({ items: await listCatalog(principal) }));
