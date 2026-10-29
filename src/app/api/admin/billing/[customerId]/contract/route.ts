import { api, readJson } from "@/lib/http/api";
import { endContract, saveContract } from "@/lib/billing/service";

export const dynamic = "force-dynamic";

export const PUT = api(async ({ req, principal, params }) => saveContract(principal, params.customerId, await readJson(req)), { recentAuth: true });
export const DELETE = api(async ({ principal, params }) => endContract(principal, params.customerId), { recentAuth: true });
