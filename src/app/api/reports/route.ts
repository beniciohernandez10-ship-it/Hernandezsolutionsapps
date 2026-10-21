import { api } from "@/lib/http/api";
import { buildReport } from "@/lib/reports/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ req, principal }) => buildReport(principal, Object.fromEntries(req.nextUrl.searchParams.entries())), { rate: [60, 60] });
