import { z } from "zod";
import { api, readJson } from "@/lib/http/api";
import { articleFeedback } from "@/lib/kb/service";

export const dynamic = "force-dynamic";

const schema = z.object({ helpful: z.boolean() });

export const POST = api(async ({ req, principal, params }) => articleFeedback(principal, params.id, schema.parse(await readJson(req)).helpful), {
  rate: [30, 60],
});
