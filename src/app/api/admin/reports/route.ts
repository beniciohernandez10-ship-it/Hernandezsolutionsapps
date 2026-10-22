import { api, readJson } from "@/lib/http/api";
import { runMonthlyReport } from "@/lib/reports/monthly";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Operators: build (or rebuild) one client's monthly report. */
export const POST = api(async ({ req, principal }) => runMonthlyReport(principal, await readJson(req)), { rate: [20, 60] });
