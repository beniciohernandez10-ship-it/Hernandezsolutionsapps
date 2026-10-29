import { api, readJson } from "@/lib/http/api";
import { saveMonitorSettings } from "@/lib/monitoring/service";

export const dynamic = "force-dynamic";

export const PUT = api(async ({ req, principal, params }) => saveMonitorSettings(principal, params.customerId, await readJson(req)), { recentAuth: true });
