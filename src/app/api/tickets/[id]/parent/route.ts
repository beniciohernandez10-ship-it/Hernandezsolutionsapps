import { api, readJson } from "@/lib/http/api";
import { setParent } from "@/lib/productivity/service";

export const dynamic = "force-dynamic";

export const PUT = api(async ({ req, principal, params }) => setParent(principal, params.id, await readJson(req)), { rate: [30, 60] });
