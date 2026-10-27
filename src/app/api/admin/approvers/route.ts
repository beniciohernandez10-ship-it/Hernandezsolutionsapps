import { api, readJson } from "@/lib/http/api";
import { addApprover, listApproverSetup, removeApprover } from "@/lib/catalog/approvers";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal }) => ({ items: await listApproverSetup(principal) }));
export const POST = api(async ({ req, principal }) => addApprover(principal, await readJson(req)), { recentAuth: true });
export const DELETE = api(async ({ req, principal }) => removeApprover(principal, await readJson(req)), { recentAuth: true });
