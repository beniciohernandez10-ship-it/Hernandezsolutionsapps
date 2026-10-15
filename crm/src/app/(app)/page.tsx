import { AlarmClock, ArrowRight, MailCheck, Phone } from "lucide-react";
import Link from "next/link";
import { BarChartView } from "@/components/charts";
import { DashboardGrid, type LayoutItem, type WidgetDef } from "@/components/dashboard/grid";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, Progress, Stat } from "@/components/ui/misc";
import { requireUser } from "@/lib/auth/session";
import { ACTIVITY_LABEL, TASK_TYPE_LABEL } from "@/lib/constants";
import { dayKey, endOfDay, formatDate, formatDateTime, startOfDay } from "@/lib/dates";
import { db } from "@/lib/db";
import { followUpCounts, leadOverview, revenueOverview, salesActivity, todayRange, weekRange } from "@/lib/metrics";
import { usd } from "@/lib/money";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Dashboard" };

const DEFAULT_LAYOUT: LayoutItem[] = [
  { id: "today", visible: true },
  { id: "follow-ups", visible: true },
  { id: "leads", visible: true },
  { id: "revenue", visible: true },
  { id: "activity", visible: true, wide: true },
  { id: "funnel", visible: true },
  { id: "industry", visible: true },
  { id: "region", visible: true },
  { id: "recent", visible: true },
];

function layoutFor(saved: unknown): LayoutItem[] {
  if (!Array.isArray(saved)) return DEFAULT_LAYOUT;
  const known = new Set(DEFAULT_LAYOUT.map((d) => d.id));
  const items = (saved as LayoutItem[]).filter((i) => i && known.has(i.id));
  // Widgets added after the layout was saved appear at the end.
  for (const d of DEFAULT_LAYOUT) if (!items.some((i) => i.id === d.id)) items.push(d);
  return items;
}

function Tile({ title, href, children, description }: { title: string; href?: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="h-full">
      <CardHeader title={title} description={description} action={href ? <Link href={href} className="flex items-center gap-1 text-xs text-accent hover:underline">Open <ArrowRight className="size-3" /></Link> : null} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const sales = await getSetting("sales");
  const today = dayKey();
  const [leads, revenue, todayStats, weekStats, fu, myCallsToday, approvals, failed, dueTasks, recent, layoutRow] = await Promise.all([
    leadOverview(),
    revenueOverview(sales.pricePerUser),
    salesActivity(todayRange()),
    salesActivity(weekRange()),
    followUpCounts(user.id),
    db.activity.count({ where: { userId: user.id, type: "CALL", occurredAt: { gte: startOfDay(today), lt: endOfDay(today) } } }),
    db.emailMessage.count({ where: { status: "PENDING_APPROVAL" } }),
    db.emailMessage.count({ where: { status: "FAILED" } }),
    db.task.findMany({
      where: { completedAt: null, dueAt: { lt: endOfDay(today) }, OR: [{ assigneeId: user.id }, { assigneeId: null }], company: { archived: false } },
      include: { company: { select: { id: true, name: true } } },
      orderBy: { dueAt: "asc" },
      take: 8,
    }),
    db.activity.findMany({ orderBy: { occurredAt: "desc" }, take: 10, include: { company: { select: { id: true, name: true } }, user: { select: { name: true } } } }),
    db.user.findUnique({ where: { id: user.id }, select: { dashboardLayout: true } }),
  ]);
  const todayStart = startOfDay(today);

  const widgets: WidgetDef[] = [
    {
      id: "today",
      title: "Today's calls",
      node: (
        <Tile title="Today's calls" href="/calls">
          <div className="mb-3 flex items-end justify-between">
            <Stat label="Your calls today" value={`${myCallsToday} / ${user.dailyCallGoal}`} tone={myCallsToday >= user.dailyCallGoal ? "success" : undefined} />
            <Button asChild variant="primary"><Link href="/calls"><Phone /> Start calling</Link></Button>
          </div>
          <Progress value={myCallsToday} max={user.dailyCallGoal} />
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat label="Reached" value={todayStats.reached} />
            <Stat label="Emails sent" value={todayStats.emails} />
            <Stat label="Meetings booked" value={todayStats.meetingsBooked} />
          </div>
          {approvals || failed ? (
            <Alert tone="accent" className="mt-4">
              <Link href="/outreach" className="flex items-center gap-2 hover:underline">
                <MailCheck className="size-4" /> {approvals} email{approvals === 1 ? "" : "s"} waiting for your approval{failed ? `, ${failed} failed` : ""}
              </Link>
            </Alert>
          ) : null}
        </Tile>
      ),
    },
    {
      id: "follow-ups",
      title: "Follow-ups due",
      node: (
        <Tile title="Follow-ups due" href="/follow-ups" description={`${fu.overdue} overdue · ${fu.dueToday} due today`}>
          {dueTasks.length ? (
            <ul className="divide-y divide-border text-sm">
              {dueTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2">
                  <AlarmClock className={t.dueAt < todayStart ? "size-4 shrink-0 text-danger" : "size-4 shrink-0 text-warning"} />
                  <Link href={`/leads/${t.company.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{t.company.name}</Link>
                  <span className="shrink-0 text-xs text-muted">{TASK_TYPE_LABEL[t.type]}</span>
                  <span className={t.dueAt < todayStart ? "w-20 shrink-0 text-right text-xs text-danger" : "w-20 shrink-0 text-right text-xs text-muted"}>
                    {t.dueAt < todayStart ? formatDate(t.dueAt, { month: "short", day: "numeric" }) : formatDate(t.dueAt, { hour: "numeric", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing due. You&apos;re caught up.</p>
          )}
        </Tile>
      ),
    },
    {
      id: "leads",
      title: "Lead overview",
      node: (
        <Tile title="Lead overview" href="/leads">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Total prospects" value={leads.total} hint={`${leads.newThisWeek} added this week`} />
            <Stat label="Not yet contacted" value={leads.untouched} />
            <Stat label="Attempted" value={leads.attempted} />
            <Stat label="Contacted" value={leads.contacted} />
            <Stat label="Interested" value={leads.interested} />
            <Stat label="Meetings" value={leads.meetings} />
            <Stat label="Proposals out" value={leads.proposals} />
            <Stat label="Won" value={leads.won} tone={leads.won ? "success" : undefined} />
            <Stat label="Overdue follow-ups" value={leads.overdueFollowUps} tone={leads.overdueFollowUps ? "danger" : undefined} />
          </div>
          <p className="mt-4 text-xs text-muted">
            <Link href="/leads?view=startups" className="hover:underline">{leads.startups} startups</Link> ·{" "}
            <Link href="/leads?view=veterinary" className="hover:underline">{leads.veterinary} veterinary practices (separate list)</Link>
          </p>
        </Tile>
      ),
    },
    {
      id: "revenue",
      title: "Revenue overview",
      node: (
        <Tile title="Revenue overview" href="/analytics" description={`Pipeline values are estimates at ${usd(sales.pricePerUser)}/user/month unless a deal has custom pricing.`}>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Contracted MRR" value={usd(revenue.contractedMrr)} hint={`${revenue.activeClients} active client${revenue.activeClients === 1 ? "" : "s"} · ${usd(revenue.contractedArr)}/yr`} tone={revenue.contractedMrr ? "success" : undefined} />
            <Stat label="Won this month" value={usd(revenue.wonThisMonthMrr)} hint={`${usd(revenue.wonThisMonthImplementation)} implementation`} />
            <Stat label="Potential MRR (estimate)" value={usd(revenue.potentialMrr)} hint={`${usd(revenue.potentialArr)}/yr across ${revenue.openDeals} open deals`} />
            <Stat label="Weighted pipeline" value={usd(revenue.weighted)} hint={`${usd(revenue.implementation)} in implementation fees`} />
          </div>
          {revenue.missingUserCounts ? (
            <p className="mt-4 text-xs text-warning">{revenue.missingUserCounts} open deals have no user count yet, so they add $0 to the estimates.</p>
          ) : null}
        </Tile>
      ),
    },
    {
      id: "activity",
      title: "Sales activity",
      node: (
        <Tile title="Sales activity" href="/analytics" description="Everyone's activity this week.">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            <Stat label="Calls today" value={todayStats.calls} />
            <Stat label="Calls this week" value={weekStats.calls} />
            <Stat label="Contact rate" value={weekStats.contactRate === null ? "—" : `${weekStats.contactRate}%`} hint="Calls that reached someone" />
            <Stat label="Emails this week" value={weekStats.emails} />
            <Stat label="Response rate" value={weekStats.responseRate === null ? "—" : `${weekStats.responseRate}%`} hint="Emailed prospects who replied" />
            <Stat label="Follow-ups due" value={fu.overdue + fu.dueToday} tone={fu.overdue ? "danger" : undefined} />
            <Stat label="Meetings this week" value={weekStats.meetingsScheduled} />
            <Stat label="Lead → client" value={weekStats.conversionRate === null ? "—" : `${weekStats.conversionRate}%`} hint="Of prospects contacted" />
          </div>
        </Tile>
      ),
    },
    {
      id: "funnel",
      title: "Pipeline by stage",
      node: (
        <Tile title="Pipeline by stage" href="/pipeline">
          <BarChartView data={leads.byStage.filter((s) => s.count > 0).map((s) => ({ stage: s.label, count: s.count }))} xKey="stage" series={[{ key: "count", label: "Prospects" }]} horizontal />
        </Tile>
      ),
    },
    {
      id: "industry",
      title: "Potential MRR by industry",
      node: (
        <Tile title="Potential MRR by industry" description="Open deals only. Estimates, not revenue.">
          <BarChartView data={revenue.byIndustry.filter((r) => r.mrr > 0).slice(0, 10).map((r) => ({ industry: r.label, mrr: r.mrr, weighted: r.weighted }))} xKey="industry" series={[{ key: "mrr", label: "Potential MRR" }, { key: "weighted", label: "Weighted (first year)" }]} horizontal currency />
        </Tile>
      ),
    },
    {
      id: "region",
      title: "Potential MRR by region",
      node: (
        <Tile title="Potential MRR by region" description="Open deals only. Estimates, not revenue.">
          <BarChartView data={revenue.byRegion.filter((r) => r.mrr > 0).map((r) => ({ region: r.label, mrr: r.mrr }))} xKey="region" series={[{ key: "mrr", label: "Potential MRR" }]} horizontal currency />
        </Tile>
      ),
    },
    {
      id: "recent",
      title: "Recent activity",
      node: (
        <Tile title="Recent activity">
          {recent.length ? (
            <ul className="space-y-2 text-sm">
              {recent.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <span className="w-28 shrink-0 text-xs text-subtle">{formatDateTime(a.occurredAt)}</span>
                  <span className="min-w-0">
                    <Link href={`/leads/${a.company.id}`} className="font-medium hover:underline">{a.company.name}</Link>
                    <span className="text-muted"> · {a.summary || ACTIVITY_LABEL[a.type]}{a.user ? ` · ${a.user.name}` : ""}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No activity yet. Import your leads or add one to get started.</p>
          )}
        </Tile>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-1">
        <h1 className="text-xl font-semibold tracking-tight">Good {greeting()}, {user.name.split(" ")[0]}</h1>
        <p className="text-sm text-muted">{formatDate(new Date(), { weekday: "long", month: "long", day: "numeric" })}</p>
      </div>
      <DashboardGrid widgets={widgets} layout={layoutFor(layoutRow?.dashboardLayout)} />
    </div>
  );
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: process.env.BUSINESS_TZ || "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}
