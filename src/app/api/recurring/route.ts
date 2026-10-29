import { api, readJson } from "@/lib/http/api";
import { saveRecurring } from "@/lib/recurring/service";

export const dynamic = "force-dynamic";

export const POST = api(async ({ req, principal }) => saveRecurring(principal, null, await readJson(req)));
