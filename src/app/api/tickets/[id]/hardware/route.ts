import { z } from "zod";
import { api, readJson } from "@/lib/http/api";
import { drainAfterResponse } from "@/lib/http/after-response";
import { markDelivered, markOrdered, receiveHardware } from "@/lib/hardware/service";

export const dynamic = "force-dynamic";

const step = z.object({ action: z.enum(["ordered", "received", "delivered"]) }).loose();

/** Moves a hardware request along: { action: "ordered" | "received" | "delivered", ...details }. Staff only. */
export const POST = api(
  async ({ req, principal, params }) => {
    const body = step.parse(await readJson(req));
    const r =
      body.action === "ordered"
        ? await markOrdered(principal, params.id, body)
        : body.action === "received"
          ? await receiveHardware(principal, params.id, body)
          : await markDelivered(principal, params.id, body);
    drainAfterResponse();
    return r;
  },
  { rate: [30, 60] },
);
