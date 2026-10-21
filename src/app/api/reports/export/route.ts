import { api } from "@/lib/http/api";
import { exportTicketsCsv, reportSchema } from "@/lib/reports/service";

export const dynamic = "force-dynamic";

/** CSV of one customer's requests for a month (technicians only). */
export const GET = api(
  async ({ req, principal }) => {
    const params = reportSchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    const csv = await exportTicketsCsv(principal, params);
    return new Response(`﻿${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="tickets-${params.month}.csv"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  },
  { rate: [20, 60] },
);
