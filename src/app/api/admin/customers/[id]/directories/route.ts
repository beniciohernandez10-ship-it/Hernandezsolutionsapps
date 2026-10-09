import { api, readJson } from "@/lib/http/api";
import { mapDirectory } from "@/lib/admin/service";

export const dynamic = "force-dynamic";

export const POST = api(async ({ req, principal, params }) => mapDirectory(principal, params.id, await readJson(req)), { recentAuth: true });
