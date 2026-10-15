import { audit } from "@/lib/audit";
import { routeUser } from "@/lib/auth/session";
import { csvResponse, toCsv } from "@/lib/csv";
import { dailySeries, industryPerformance, revenueOverview } from "@/lib/metrics";
import { parseRange } from "@/lib/range";
import { getSetting } from "@/lib/settings";

export async function GET(req: Request) {
  const user = await routeUser("VIEWER");
  if (user instanceof Response) return user;
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const range = parseRange(sp);
  const suffix = `${range.fromDay}_to_${range.toDay}`;
  await audit(user.id, "export.analytics", undefined, { kind: sp.kind, from: range.fromDay, to: range.toDay });
  if (sp.kind === "industry") {
    const rows = await industryPerformance();
    return csvResponse(`industry-performance.csv`, toCsv(["Industry", "Prospects", "Contacted", "Interested or later", "Won"], rows.map((r) => [r.industry, r.total, r.contacted, r.interested, r.won])));
  }
  if (sp.kind === "revenue") {
    const sales = await getSetting("sales");
    const r = await revenueOverview(sales.pricePerUser);
    const rows: unknown[][] = [
      ["Summary", "Contracted MRR", r.contractedMrr, ""],
      ["Summary", "Contracted ARR", r.contractedArr, ""],
      ["Summary", "Potential MRR (estimate)", r.potentialMrr, r.openDeals],
      ["Summary", "Weighted pipeline (estimate)", r.weighted, ""],
      ["Summary", "Implementation fees, open deals (estimate)", r.implementation, ""],
      ...r.byIndustry.map((g) => ["Industry", g.label, g.mrr, g.deals]),
      ...r.byRegion.map((g) => ["Region", g.label, g.mrr, g.deals]),
    ];
    return csvResponse(`revenue.csv`, toCsv(["Group", "Name", "Amount (USD)", "Open deals"], rows));
  }
  const series = await dailySeries(range);
  return csvResponse(`daily-activity_${suffix}.csv`, toCsv(["Day", "Calls", "Reached", "Emails sent", "Replies"], series.map((d) => [d.day, d.calls, d.reached, d.emails, d.replies])));
}
