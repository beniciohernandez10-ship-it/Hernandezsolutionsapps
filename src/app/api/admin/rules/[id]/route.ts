import { api, readJson } from "@/lib/http/api";
import { deleteRule, saveRule } from "@/lib/productivity/service";

export const dynamic = "force-dynamic";

export const PUT = api(async ({ req, principal, params }) => saveRule(principal, params.id, await readJson(req)), { recentAuth: true });
export const DELETE = api(async ({ principal, params }) => deleteRule(principal, params.id), { recentAuth: true });
