import { api, readJson } from "@/lib/http/api";
import { mergeTicket } from "@/lib/productivity/service";
import { drainAfterResponse } from "@/lib/http/after-response";

export const dynamic = "force-dynamic";

export const POST = api(
  async ({ req, principal, params }) => {
    const r = await mergeTicket(principal, params.id, await readJson(req));
    drainAfterResponse();
    return r;
  },
  { rate: [20, 60] },
);
