import { api, readJson } from "@/lib/http/api";
import { updateTicketFields } from "@/lib/fields/service";

export const dynamic = "force-dynamic";

export const PUT = api(async ({ req, principal, params }) => updateTicketFields(principal, params.id, await readJson(req)));
