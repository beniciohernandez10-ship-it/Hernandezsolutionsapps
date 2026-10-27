import { api, readJson } from "@/lib/http/api";
import { getHardwareSettings, saveHardwareSettings } from "@/lib/hardware/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal }) => getHardwareSettings(principal));
export const PUT = api(async ({ req, principal }) => saveHardwareSettings(principal, await readJson(req)), { recentAuth: true });
