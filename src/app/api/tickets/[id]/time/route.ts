import { api, readJson } from "@/lib/http/api";
import { logTime, ticketTime } from "@/lib/billing/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal, params }) => ticketTime(principal, params.id));
export const POST = api(
  async ({ req, principal, params }) => logTime(principal, { ...((await readJson(req)) as object), ticketId: params.id }),
  { rate: [60, 60] },
);
