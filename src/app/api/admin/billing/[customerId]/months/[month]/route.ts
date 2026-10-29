import { api } from "@/lib/http/api";
import { billingCsv, finalizeMonth, reopenMonth } from "@/lib/billing/service";

export const dynamic = "force-dynamic";

/** The month as invoice-ready CSV. */
export const GET = api(async ({ principal, params }) => {
  const { filename, csv } = await billingCsv(principal, params.customerId, params.month);
  return new Response(`﻿${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
/** Finalize (invoiced: locks the month's entries). */
export const POST = api(async ({ principal, params }) => finalizeMonth(principal, params.customerId, params.month), { recentAuth: true });
/** Reopen a finalized month for corrections. */
export const DELETE = api(async ({ principal, params }) => reopenMonth(principal, params.customerId, params.month), { recentAuth: true });
