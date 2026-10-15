import { Download } from "lucide-react";
import Link from "next/link";
import { BarChartView, DonutView, LineChartView } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader, Stat } from "@/components/ui/misc";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { dailySeries, industryPerformance, leadOverview, revenueOverview, salesActivity } from "@/lib/metrics";
import { usd } from "@/lib/money";
import { PRESETS, parseRange } from "@/lib/range";
import { getSetting } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const range = parseRange(sp);
  const sales = await getSetting("sales");
  const [activity, series, industries, leads, revenue, added] = await Promise.all([
    salesActivity(range),
    dailySeries(range),
    industryPerformance(),
    leadOverview(),
    revenueOverview(sales.pricePerUser),
    db.company.count({ where: { createdAt: { gte: range.from, lt: range.to } } }),
  ]);
  const qs = `from=${range.fromDay}&to=${range.toDay}`;
  const chartData = series.map((d) => ({ day: d.day.slice(5), calls: d.calls, reached: d.reached, emails: d.emails, replies: d.replies }));

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Activity and results for the selected dates. Pipeline values are estimates; contracted revenue comes only from clients."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" size="sm"><a href={`/api/export/analytics?kind=daily&${qs}`}><Download /> Daily activity CSV</a></Button>
            <Button asChild variant="secondary" size="sm"><a href={`/api/export/analytics?kind=industry&${qs}`}><Download /> Industry CSV</a></Button>
            <Button asChild variant="secondary" size="sm"><a href={`/api/export/analytics?kind=revenue&${qs}`}><Download /> Revenue CSV</a></Button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {PRESETS.map((p) => (
          <Link key={p.key} href={`/analytics?preset=${p.key}`} className={cn("rounded-full border px-3 py-1 text-sm", range.preset === p.key ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-2")}>
            {p.label}
          </Link>
        ))}
        <form className="ml-auto flex items-end gap-2" action="/analytics">
          <label className="text-xs text-muted">From<Input type="date" name="from" defaultValue={range.fromDay} className="h-8" /></label>
          <label className="text-xs text-muted">To<Input type="date" name="to" defaultValue={range.toDay} className="h-8" /></label>
          <Button type="submit" size="sm">Apply</Button>
        </form>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Card className="p-4"><Stat label="Calls" value={activity.calls} /></Card>
        <Card className="p-4"><Stat label="Reached someone" value={activity.reached} hint={activity.contactRate === null ? undefined : `${activity.contactRate}% contact rate`} /></Card>
        <Card className="p-4"><Stat label="Talk time" value={`${activity.talkMinutes} min`} /></Card>
        <Card className="p-4"><Stat label="Emails sent" value={activity.emails} /></Card>
        <Card className="p-4"><Stat label="Replies" value={activity.replies} hint={activity.responseRate === null ? undefined : `${activity.responseRate}% response rate`} /></Card>
        <Card className="p-4"><Stat label="Meetings booked" value={activity.meetingsBooked} /></Card>
        <Card className="p-4"><Stat label="Leads added" value={added} /></Card>
        <Card className="p-4"><Stat label="Lead → client" value={activity.conversionRate === null ? "—" : `${activity.conversionRate}%`} hint="All time, of contacted" /></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader title="Daily activity" />
          <CardBody><LineChartView data={chartData} xKey="day" series={[{ key: "calls", label: "Calls" }, { key: "reached", label: "Reached" }, { key: "emails", label: "Emails" }, { key: "replies", label: "Replies" }]} height={280} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Call outcomes" />
          <CardBody><DonutView data={activity.outcomes.map((o) => ({ label: o.label, value: o.count }))} height={280} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Prospects by stage" description="Current, all dates" />
          <CardBody><BarChartView data={leads.byStage.filter((s) => s.count).map((s) => ({ stage: s.label, count: s.count }))} xKey="stage" series={[{ key: "count", label: "Prospects" }]} horizontal /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Potential MRR by industry" description="Open deals, estimates" />
          <CardBody><BarChartView data={revenue.byIndustry.filter((r) => r.mrr).slice(0, 12).map((r) => ({ industry: r.label, mrr: r.mrr }))} xKey="industry" series={[{ key: "mrr", label: "Potential MRR" }]} horizontal currency /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Potential MRR by region" description="Open deals, estimates" />
          <CardBody><BarChartView data={revenue.byRegion.filter((r) => r.mrr).map((r) => ({ region: r.label, mrr: r.mrr }))} xKey="region" series={[{ key: "mrr", label: "Potential MRR" }]} horizontal currency /></CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Industry performance" description="All prospects to date: how far each industry has progressed." />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Industry</th>
                  <th className="px-4 py-2 text-right font-medium">Prospects</th>
                  <th className="px-4 py-2 text-right font-medium">Contacted</th>
                  <th className="px-4 py-2 text-right font-medium">Interested or later</th>
                  <th className="px-4 py-2 text-right font-medium">Won</th>
                  <th className="px-4 py-2 text-right font-medium">Contacted → interested</th>
                </tr>
              </thead>
              <tbody>
                {industries.map((r) => (
                  <tr key={r.industry} className="border-t border-border">
                    <td className="px-4 py-2">{r.industry}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.total}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.contacted}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.interested}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.won}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.contacted ? `${Math.round((r.interested / r.contacted) * 100)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Revenue" />
          <CardBody className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <Stat label="Contracted MRR" value={usd(revenue.contractedMrr)} hint={`${revenue.activeClients} clients`} />
            <Stat label="Contracted ARR" value={usd(revenue.contractedArr)} />
            <Stat label="Potential MRR (estimate)" value={usd(revenue.potentialMrr)} />
            <Stat label="Weighted pipeline" value={usd(revenue.weighted)} />
            <Stat label="Implementation (open deals)" value={usd(revenue.implementation)} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
