import { api, readJson } from "@/lib/http/api";
import { getChange, updateChange } from "@/lib/changes/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal, params }) => getChange(principal, params.id));
export const PUT = api(async ({ req, principal, params }) => updateChange(principal, params.id, await readJson(req)), { rate: [30, 60] });
