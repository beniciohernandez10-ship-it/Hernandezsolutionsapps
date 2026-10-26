import { api, readJson } from "@/lib/http/api";
import { drainAfterResponse } from "@/lib/http/after-response";
import { bulkUpdate } from "@/lib/queues/service";

export const dynamic = "force-dynamic";

export const POST = api(
  async ({ req, principal }) => {
    const r = await bulkUpdate(principal, await readJson(req));
    drainAfterResponse();
    return r;
  },
  { rate: [30, 60] },
);
