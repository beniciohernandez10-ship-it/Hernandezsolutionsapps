import { api, readJson } from "@/lib/http/api";
import { deleteQueue, saveQueue } from "@/lib/queues/service";

export const dynamic = "force-dynamic";

export const PUT = api(async ({ req, principal, params }) => saveQueue(principal, params.id, await readJson(req)), { recentAuth: true });
export const DELETE = api(async ({ req, principal, params }) => deleteQueue(principal, params.id, await readJson(req)), { recentAuth: true });
