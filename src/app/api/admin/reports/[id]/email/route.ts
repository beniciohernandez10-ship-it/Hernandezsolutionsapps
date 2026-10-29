import { api } from "@/lib/http/api";
import { emailReportNow } from "@/lib/reports/emails";

export const dynamic = "force-dynamic";

/** Emails this report's summary to the client's administrators now. */
export const POST = api(async ({ principal, params }) => emailReportNow(principal, params.id), { rate: [10, 300] });
