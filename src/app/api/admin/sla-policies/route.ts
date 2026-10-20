import { api, readJson } from "@/lib/http/api";
import { listSlaPolicies, saveSlaPolicy } from "@/lib/sla/admin";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal }) => listSlaPolicies(principal));
export const POST = api(async ({ req, principal }) => saveSlaPolicy(principal, null, await readJson(req)), { recentAuth: true });
