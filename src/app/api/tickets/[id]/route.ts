import { api, readJson } from "@/lib/http/api";
import { getTicket, updateTicket } from "@/lib/tickets/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal, params }) => getTicket(principal, params.id));

export const PATCH = api(async ({ req, principal, params }) => updateTicket(principal, params.id, await readJson(req)), {
  rate: [60, 60],
});
