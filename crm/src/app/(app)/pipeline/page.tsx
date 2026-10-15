import Link from "next/link";
import { PipelineBoard, type BoardCard } from "@/components/pipeline/board";
import { Card } from "@/components/ui/card";
import { PageHeader, Stat } from "@/components/ui/misc";
import { canWrite } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { INDUSTRY_LABEL } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { leadWhere, parseLeadFilters, type LeadView } from "@/lib/leads/filters";
import { monthlyValue, pipelineTotals, probability, usd, weightedValue } from "@/lib/money";
import { getSetting } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const metadata = { title: "Pipeline" };

const VIEWS: { key: LeadView; label: string }[] = [
  { key: "general", label: "Prospects" },
  { key: "startups", label: "Startups" },
  { key: "veterinary", label: "Veterinary" },
  { key: "all", label: "Everything" },
];

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filters = parseLeadFilters(sp);
  const mine = sp.owner === "me";
  const [rows, sales] = await Promise.all([
    db.company.findMany({
      where: { ...leadWhere({ ...filters, owner: mine ? user.id : filters.owner }) },
      select: {
        id: true, name: true, industry: true, city: true, stage: true, priority: true, score: true, scoreIsEstimate: true, managedUsers: true, pricePerUser: true,
        monthlyValueOverride: true, implementationFee: true, closeProbability: true, nextFollowUpAt: true, stageChangedAt: true, owner: { select: { name: true } },
      },
      orderBy: [{ priority: "asc" }, { score: { sort: "desc", nulls: "last" } }],
      take: 2000,
    }),
    getSetting("sales"),
  ]);
  const now = Date.now();
  const cards: BoardCard[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    industry: INDUSTRY_LABEL[r.industry] ?? r.industry,
    city: r.city,
    stage: r.stage,
    priority: r.priority,
    score: r.score,
    scoreIsEstimate: r.scoreIsEstimate,
    monthly: monthlyValue(r, sales.pricePerUser),
    weighted: weightedValue(r, sales.pricePerUser),
    probability: probability(r),
    owner: r.owner?.name ?? null,
    next: r.nextFollowUpAt ? formatDate(r.nextFollowUpAt, { month: "short", day: "numeric" }) : null,
    overdue: !!r.nextFollowUpAt && r.nextFollowUpAt.getTime() < now,
    daysInStage: Math.floor((now - r.stageChangedAt.getTime()) / 86400_000),
  }));
  const totals = pipelineTotals(rows.map((r) => ({ ...r })), sales.pricePerUser);
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = { view: filters.view === "general" ? undefined : filters.view, owner: mine ? "me" : undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/pipeline${p.size ? `?${p}` : ""}`;
  };

  return (
    <div>
      <PageHeader title="Pipeline" description="Drag a prospect to another stage. Every move is recorded on its timeline. Values are estimates, not revenue." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4"><Stat label="Open deals" value={totals.openDeals} /></Card>
        <Card className="p-4"><Stat label="Potential MRR" value={usd(totals.potentialMrr)} hint={`${usd(totals.potentialArr)} a year`} /></Card>
        <Card className="p-4"><Stat label="Implementation fees" value={usd(totals.implementation)} /></Card>
        <Card className="p-4"><Stat label="Weighted pipeline" value={usd(totals.weighted)} hint="First-year value × close probability" /></Card>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-sm">
        {VIEWS.map((v) => (
          <Link key={v.key} href={link({ view: v.key === "general" ? undefined : v.key })} className={cn("rounded-full border px-3 py-1", filters.view === v.key ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-2")}>
            {v.label}
          </Link>
        ))}
        <span className="mx-2 h-5 w-px bg-border" />
        <Link href={link({ owner: mine ? undefined : "me" })} className={cn("rounded-full border px-3 py-1", mine ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-2")}>
          Only mine
        </Link>
      </div>
      <PipelineBoard cards={cards} canEdit={canWrite(user.role)} />
    </div>
  );
}
