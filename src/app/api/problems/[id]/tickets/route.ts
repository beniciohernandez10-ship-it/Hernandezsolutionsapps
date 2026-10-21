import { api, readJson } from "@/lib/http/api";
import { linkProblemTicket } from "@/lib/problems/service";

export const dynamic = "force-dynamic";

export const POST = api(async ({ req, principal, params }) => linkProblemTicket(principal, params.id, await readJson(req)), { rate: [60, 60] });
