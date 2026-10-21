import { api, readJson } from "@/lib/http/api";
import { getProblem, updateProblem } from "@/lib/problems/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal, params }) => getProblem(principal, params.id));
export const PUT = api(async ({ req, principal, params }) => updateProblem(principal, params.id, await readJson(req)), { rate: [30, 60] });
