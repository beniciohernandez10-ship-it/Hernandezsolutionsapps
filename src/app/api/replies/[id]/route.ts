import { api, readJson } from "@/lib/http/api";
import { deleteCanned, saveCanned } from "@/lib/productivity/service";

export const dynamic = "force-dynamic";

export const PUT = api(async ({ req, principal, params }) => saveCanned(principal, params.id, await readJson(req)), { rate: [30, 60] });
export const DELETE = api(async ({ principal, params }) => deleteCanned(principal, params.id), { rate: [30, 60] });
