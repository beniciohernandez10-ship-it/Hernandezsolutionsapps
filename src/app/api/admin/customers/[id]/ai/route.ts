import { api, readJson } from "@/lib/http/api";
import { setCustomerAi } from "@/lib/ai/service";

export const dynamic = "force-dynamic";

export const PUT = api(async ({ req, principal, params }) => setCustomerAi(principal, params.id, await readJson(req)), { recentAuth: true });
