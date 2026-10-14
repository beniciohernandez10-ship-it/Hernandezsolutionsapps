import { api, readJson } from "@/lib/http/api";
import { setCustomerStatus } from "@/lib/admin/service";

export const dynamic = "force-dynamic";

export const PATCH = api(async ({ req, principal, params }) => setCustomerStatus(principal, params.id, await readJson(req)), { recentAuth: true });
