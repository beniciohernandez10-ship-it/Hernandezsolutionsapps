import { api, readJson } from "@/lib/http/api";
import { linkChangeTicket } from "@/lib/changes/service";
import { drainAfterResponse } from "@/lib/http/after-response";

export const dynamic = "force-dynamic";

export const POST = api(
  async ({ req, principal, params }) => {
    const r = await linkChangeTicket(principal, params.id, await readJson(req));
    drainAfterResponse();
    return r;
  },
  { rate: [30, 60] },
);
