import { api, readJson } from "@/lib/http/api";
import { listQueuesAdmin, saveQueue } from "@/lib/queues/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal }) => ({ items: await listQueuesAdmin(principal) }));
export const POST = api(async ({ req, principal }) => saveQueue(principal, null, await readJson(req)), { recentAuth: true });
