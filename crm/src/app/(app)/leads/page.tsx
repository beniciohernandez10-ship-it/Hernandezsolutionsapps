import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { LeadFiltersBar } from "@/components/leads/filters-bar";
import { LeadsTable, type LeadRow } from "@/components/leads/leads-table";
import { requireUser } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/roles";
import { addDays, dayKey, endOfDay, startOfDay } from "@/lib/dates";
import { db, type Prisma } from "@/lib/db";
import { leadWhere, parseLeadFilters } from "@/lib/leads/filters";
import { getSetting } from "@/lib/settings";
import { monthlyValue } from "@/lib/money";

export const metadata = { title: "Prospects" };

const SORTS: Record<string, (dir: "asc" | "desc") => Prisma.CompanyOrderByWithRelationInput> = {
  name: (dir) => ({ name: dir }),
  score: (dir) => ({ score: { sort: dir, nulls: "last" } }),
  priority: (dir) => ({ priority: dir }),
  stage: (dir) => ({ stage: dir }),
  city: (dir) => ({ city: { sort: dir, nulls: "last" } }),
  industry: (dir) => ({ industry: dir }),
  next: (dir) => ({ nextFollowUpAt: { sort: dir, nulls: "last" } }),
  last: (dir) => ({ lastContactedAt: { sort: dir, nulls: "last" } }),
  created: (dir) => ({ createdAt: dir }),
  employees: (dir) => ({ employeeCount: { sort: dir, nulls: "last" } }),
};

const TITLES = { general: "All prospects", startups: "Startups", veterinary: "Veterinary practices", all: "All records" } as const;
const DESCRIPTIONS = {
  general: "Every prospect except veterinary practices, which have their own list.",
  startups: "Startups across every industry. Each keeps its real industry classification.",
  veterinary: "Veterinary hospitals and practices, kept separate from the general prospect list.",
  all: "Every prospect, including veterinary practices.",
} as const;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filters = parseLeadFilters(sp);
  const today = dayKey();
  const where = leadWhere(filters, new Date(), { start: startOfDay(today), end: endOfDay(today), weekEnd: endOfDay(addDays(today, 7)) });
  const sortKey = typeof sp.sort === "string" && SORTS[sp.sort] ? sp.sort : "score";
  const dir = sp.dir === "asc" ? "asc" : "desc";
  const pageSize = [25, 50, 100, 250].includes(Number(sp.size)) ? Number(sp.size) : 50;
  const page = Math.max(1, Number(sp.page) || 1);

  const [total, companies, users, views, sales, sequences] = await Promise.all([
    db.company.count({ where }),
    db.company.findMany({
      where,
      orderBy: [SORTS[sortKey](dir), { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        owner: { select: { name: true } },
        contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 },
        _count: { select: { contacts: true } },
      },
    }),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.savedView.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    getSetting("sales"),
    db.sequence.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const rows: LeadRow[] = companies.map((c) => {
    const contact = c.contacts[0];
    return {
      id: c.id,
      name: c.name,
      industry: c.industry,
      subindustry: c.subindustry,
      businessStage: c.businessStage,
      city: c.city,
      state: c.state,
      region: c.region,
      headquarters: c.headquarters,
      contactName: contact?.name ?? null,
      contactTitle: contact?.title ?? null,
      contactCount: c._count.contacts,
      phone: contact?.phone || c.mainPhone,
      phoneStatus: contact?.phone ? contact.phoneStatus : c.mainPhoneStatus,
      email: contact?.email || c.mainEmail,
      emailStatus: contact?.email ? contact.emailStatus : c.mainEmailStatus,
      contactMethod: c.preferredContactMethod,
      stage: c.stage,
      priority: c.priority,
      score: c.score,
      scoreIsEstimate: c.scoreIsEstimate,
      nextFollowUpAt: c.nextFollowUpAt?.toISOString() ?? null,
      lastContactedAt: c.lastContactedAt?.toISOString() ?? null,
      owner: c.owner?.name ?? null,
      employeeCount: c.employeeCount,
      monthly: c.managedUsers || c.monthlyValueOverride ? monthlyValue(c, sales.pricePerUser) : null,
      tags: c.tags,
      doNotContact: c.doNotContact,
    };
  });

  return (
    <>
      <PageHeader
        title={TITLES[filters.view]}
        description={DESCRIPTIONS[filters.view]}
        actions={
          canWrite(user.role) ? (
            <Button asChild variant="primary">
              <Link href={`/leads/new${filters.view === "veterinary" ? "?industry=veterinary" : filters.view === "startups" ? "?startup=1" : ""}`}>
                <Plus /> Add prospect
              </Link>
            </Button>
          ) : null
        }
      />
      <LeadFiltersBar filters={filters} users={users} views={views.map((v) => ({ id: v.id, name: v.name, filters: v.filters as Record<string, string> }))} />
      <LeadsTable
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        sort={sortKey}
        dir={dir}
        users={users}
        sequences={sequences}
        canEdit={canWrite(user.role)}
        now={new Date().toISOString()}
        todayStart={startOfDay(today).toISOString()}
      />
    </>
  );
}
