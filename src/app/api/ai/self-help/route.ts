import { api, readJson } from "@/lib/http/api";
import { selfHelp } from "@/lib/ai/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Before submitting a request: steps drawn only from published help articles. */
export const POST = api(async ({ req, principal }) => selfHelp(principal, await readJson(req)), { rate: [5, 60] });
