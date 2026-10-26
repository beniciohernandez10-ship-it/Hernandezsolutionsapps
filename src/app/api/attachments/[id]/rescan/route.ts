import { api } from "@/lib/http/api";
import { drainAfterResponse } from "@/lib/http/after-response";
import { rescanAttachment } from "@/lib/attachments/service";

export const dynamic = "force-dynamic";

/** Staff: check a file again after its scan failed. */
export const POST = api(
  async ({ principal, params }) => {
    const r = await rescanAttachment(principal, params.id);
    drainAfterResponse();
    return r;
  },
  { rate: [20, 300] },
);
