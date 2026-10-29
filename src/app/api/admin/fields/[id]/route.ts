import { api, readJson } from "@/lib/http/api";
import { deleteFieldDef, saveFieldDef } from "@/lib/fields/service";

export const dynamic = "force-dynamic";

export const PUT = api(async ({ req, principal, params }) => saveFieldDef(principal, params.id, await readJson(req)));
/** Deletes the field and every answer to it. */
export const DELETE = api(async ({ principal, params }) => deleteFieldDef(principal, params.id), { recentAuth: true });
