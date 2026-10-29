import { api, readJson } from "@/lib/http/api";
import { deleteTimeEntry, updateTimeEntry } from "@/lib/billing/service";

export const dynamic = "force-dynamic";

export const PATCH = api(async ({ req, principal, params }) => updateTimeEntry(principal, params.id, await readJson(req)), { rate: [60, 60] });
export const DELETE = api(async ({ principal, params }) => deleteTimeEntry(principal, params.id), { rate: [60, 60] });
