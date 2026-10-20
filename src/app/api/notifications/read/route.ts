import { z } from "zod";
import { api, readJson } from "@/lib/http/api";
import { markRead } from "@/lib/notify/service";

export const dynamic = "force-dynamic";

const schema = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(100) }),
  z.object({ ticketId: z.uuid() }),
  z.object({ all: z.literal(true) }),
]);

export const POST = api(async ({ req, principal }) => ({ updated: await markRead(principal, schema.parse(await readJson(req))) }), {
  rate: [60, 60],
});
