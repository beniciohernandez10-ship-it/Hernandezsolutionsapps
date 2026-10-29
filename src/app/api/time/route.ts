import { api, readJson } from "@/lib/http/api";
import { logTime } from "@/lib/billing/service";

export const dynamic = "force-dynamic";

/** General work for a client, or time on a ticket by `ticketId`. */
export const POST = api(async ({ req, principal }) => logTime(principal, await readJson(req)), { rate: [60, 60] });
