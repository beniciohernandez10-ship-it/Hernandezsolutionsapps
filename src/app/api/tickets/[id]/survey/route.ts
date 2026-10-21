import { api, readJson } from "@/lib/http/api";
import { submitSurvey } from "@/lib/surveys/service";

export const dynamic = "force-dynamic";

export const POST = api(async ({ req, principal, params }) => submitSurvey(principal, params.id, await readJson(req)), { rate: [20, 60] });
