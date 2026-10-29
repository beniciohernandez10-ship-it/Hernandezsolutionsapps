import { api, readJson } from "@/lib/http/api";
import { setReportEmails } from "@/lib/reports/emails";

export const dynamic = "force-dynamic";

/** Turns automatic month-end report emails on or off for a client. */
export const PUT = api(async ({ req, principal, params }) => setReportEmails(principal, params.id, await readJson(req)));
