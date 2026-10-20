import { api, readJson } from "@/lib/http/api";
import { saveSlaPolicy } from "@/lib/sla/admin";

export const dynamic = "force-dynamic";

export const PUT = api(async ({ req, principal, params }) => saveSlaPolicy(principal, params.id, await readJson(req)), { recentAuth: true });
