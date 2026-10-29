import { api, readJson } from "@/lib/http/api";
import { deleteRecurring, saveRecurring } from "@/lib/recurring/service";

export const dynamic = "force-dynamic";

export const PUT = api(async ({ req, principal, params }) => saveRecurring(principal, params.id, await readJson(req)));
export const DELETE = api(async ({ principal, params }) => deleteRecurring(principal, params.id));
