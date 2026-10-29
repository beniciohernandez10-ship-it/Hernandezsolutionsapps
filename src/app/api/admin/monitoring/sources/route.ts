import { api, readJson } from "@/lib/http/api";
import { createAlertSource } from "@/lib/monitoring/service";

export const dynamic = "force-dynamic";

/** Returns the new token once; only its hash is stored. */
export const POST = api(async ({ req, principal }) => createAlertSource(principal, await readJson(req)), { recentAuth: true });
