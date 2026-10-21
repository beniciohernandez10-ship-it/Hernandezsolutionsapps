import { api, readJson } from "@/lib/http/api";
import { postIncidentUpdate } from "@/lib/incidents/service";
import { drainAfterResponse } from "@/lib/http/after-response";

export const dynamic = "force-dynamic";

export const POST = api(
  async ({ req, principal, params }) => {
    const r = await postIncidentUpdate(principal, params.id, await readJson(req));
    drainAfterResponse();
    return r;
  },
  { rate: [30, 60] },
);
