import { z } from "zod";
import { api, readJson } from "@/lib/http/api";
import { setTaskDone } from "@/lib/catalog/service";

export const dynamic = "force-dynamic";

const schema = z.object({ done: z.boolean() });

export const PATCH = api(
  async ({ req, principal, params }) => setTaskDone(principal, params.id, params.taskId, schema.parse(await readJson(req)).done),
  { rate: [120, 60] },
);
