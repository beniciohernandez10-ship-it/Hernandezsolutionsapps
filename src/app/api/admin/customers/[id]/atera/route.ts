import { api, readJson } from "@/lib/http/api";
import { mapAteraCustomer } from "@/lib/admin/service";

export const dynamic = "force-dynamic";

export const POST = api(async ({ req, principal, params }) => mapAteraCustomer(principal, params.id, await readJson(req)), { recentAuth: true });
