import { api, readJson } from "@/lib/http/api";
import { listRules, ruleTargets, saveRule } from "@/lib/productivity/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal }) => ({ items: await listRules(principal), ...(await ruleTargets(principal)) }));
export const POST = api(async ({ req, principal }) => saveRule(principal, null, await readJson(req)), { recentAuth: true });
