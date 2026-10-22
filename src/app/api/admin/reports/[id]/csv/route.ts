import { api } from "@/lib/http/api";
import { monthlyReportCsv } from "@/lib/reports/monthly";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal, params }) => {
  const { filename, csv } = await monthlyReportCsv(principal, params.id);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
});
