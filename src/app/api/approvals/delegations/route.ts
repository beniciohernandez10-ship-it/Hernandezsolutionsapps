import { api, readJson } from "@/lib/http/api";
import { addDelegation } from "@/lib/catalog/workflow";

export const dynamic = "force-dynamic";

export const POST = api(async ({ req, principal }) => addDelegation(principal, await readJson(req)), { rate: [20, 60] });
