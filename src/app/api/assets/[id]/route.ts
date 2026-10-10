import { api, readJson } from "@/lib/http/api";
import { getAsset, updateAsset } from "@/lib/assets/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal, params }) => getAsset(principal, params.id));

export const PATCH = api(async ({ req, principal, params }) => updateAsset(principal, params.id, await readJson(req)), { rate: [120, 3600] });
