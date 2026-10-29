import { api, readJson } from "@/lib/http/api";
import { saveFieldDef } from "@/lib/fields/service";

export const dynamic = "force-dynamic";

export const POST = api(async ({ req, principal }) => saveFieldDef(principal, null, await readJson(req)));
