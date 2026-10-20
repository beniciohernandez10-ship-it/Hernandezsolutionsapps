import { api, readJson } from "@/lib/http/api";
import { drainAfterResponse } from "@/lib/http/after-response";
import { getTicket, updateTicket } from "@/lib/tickets/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal, params }) => getTicket(principal, params.id));

export const PATCH = api(
  async ({ req, principal, params }) => {
    const r = await updateTicket(principal, params.id, await readJson(req));
    drainAfterResponse();
    return r;
  },
  { rate: [60, 60] },
);
