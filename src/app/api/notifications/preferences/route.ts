import { api, readJson } from "@/lib/http/api";
import { getPreferences, updatePreferences } from "@/lib/notify/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal }) => getPreferences(principal));
export const PUT = api(async ({ req, principal }) => updatePreferences(principal, await readJson(req)), { rate: [20, 60] });
