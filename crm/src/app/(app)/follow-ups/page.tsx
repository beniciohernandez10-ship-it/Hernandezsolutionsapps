import { AlarmClock, CalendarDays, Phone } from "lucide-react";
import Link from "next/link";
import { StageBadge } from "@/components/badges";
import { TaskActions } from "@/components/leads/detail-widgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { canWrite } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { TASK_TYPES, TASK_TYPE_LABEL } from "@/lib/constants";
import { addDays, dayKey, endOfDay, formatDate, startOfDay } from "@/lib/dates";
import { db, type Prisma } from "@/lib/db";
import { formatPhone, telHref } from "@/lib/normalize";
import { cn } from "@/lib/utils";

export const metadata = { title: "Follow-ups" };

type Row = Prisma.TaskGetPayload<{
  include: { company: { select: { id: true; name: true; stage: true; mainPhone: true; mainPhoneStatus: true } }; contact: { select: { name: true; phone: true } }; assignee: { select: { name: true } } };
}>;

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const type = TASK_TYPES.some((t) => t.key === sp.type) ? sp.type : undefined;
  const mine = sp.who !== "all";
  const today = dayKey();
  const todayStart = startOfDay(today);
  const todayEnd = endOfDay(today);
  const horizon = endOfDay(addDays(today, 30));
  const base: Prisma.TaskWhereInput = {
    completedAt: null,
    ...(type ? { type: type as never } : {}),
    ...(mine ? { OR: [{ assigneeId: user.id }, { assigneeId: null }] } : {}),
    company: { archived: false },
  };
  const include = {
    company: { select: { id: true, name: true, stage: true, mainPhone: true, mainPhoneStatus: true } },
    contact: { select: { name: true, phone: true } },
    assignee: { select: { name: true } },
  } as const;
  const [overdue, dueToday, upcoming, doneToday, later] = await Promise.all([
    db.task.findMany({ where: { ...base, dueAt: { lt: todayStart } }, include, orderBy: { dueAt: "asc" }, take: 200 }),
    db.task.findMany({ where: { ...base, dueAt: { gte: todayStart, lt: todayEnd } }, include, orderBy: { dueAt: "asc" } }),
    db.task.findMany({ where: { ...base, dueAt: { gte: todayEnd, lt: horizon } }, include, orderBy: { dueAt: "asc" }, take: 200 }),
    db.task.count({ where: { completedAt: { gte: todayStart }, ...(mine ? { OR: [{ assigneeId: user.id }, { assigneeId: null }] } : {}) } }),
    db.task.count({ where: { ...base, dueAt: { gte: horizon } } }),
  ]);
  const edit = canWrite(user.role);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { type, who: mine ? undefined : "all", ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/follow-ups?${s}` : "/follow-ups";
  };

  return (
    <div>
      <PageHeader
        title="Follow-ups"
        description="Callbacks, follow-up emails, meetings, proposals and contract reminders. Overdue items come first."
        actions={<Button asChild variant="secondary"><Link href="/account#calendar"><CalendarDays /> Add to my calendar</Link></Button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4"><Stat label="Overdue" value={overdue.length} tone={overdue.length ? "danger" : undefined} /></Card>
        <Card className="p-4"><Stat label="Due today" value={dueToday.length} tone={dueToday.length ? "warning" : undefined} /></Card>
        <Card className="p-4"><Stat label="Next 30 days" value={upcoming.length} /></Card>
        <Card className="p-4"><Stat label="Completed today" value={doneToday} tone={doneToday ? "success" : undefined} /></Card>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5 text-sm">
        <Link href={qs({ type: undefined })} className={cn("rounded-full border px-3 py-1", !type ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-2")}>All types</Link>
        {TASK_TYPES.map((t) => (
          <Link key={t.key} href={qs({ type: t.key })} className={cn("rounded-full border px-3 py-1", type === t.key ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-2")}>{t.label}</Link>
        ))}
        <span className="mx-2 h-5 w-px bg-border" />
        <Link href={qs({ who: mine ? "all" : undefined })} className="rounded-full border border-border px-3 py-1 hover:bg-surface-2">{mine ? "Showing mine · show everyone's" : "Showing everyone's · show mine"}</Link>
      </div>

      {!overdue.length && !dueToday.length && !upcoming.length ? (
        <EmptyState icon={<AlarmClock />} title="Nothing scheduled">
          Follow-ups you schedule from a call, an email or a prospect&apos;s profile show up here.{later ? ` ${later} more are scheduled beyond 30 days.` : ""}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {overdue.length ? <TaskGroup title="Overdue" tone="danger" rows={overdue} edit={edit} /> : null}
          <TaskGroup title="Today" tone="warning" rows={dueToday} edit={edit} empty="Nothing else due today." />
          {upcoming.length ? <TaskGroup title="Upcoming" rows={upcoming} edit={edit} showDay /> : null}
          {later ? <p className="text-xs text-muted">{later} more scheduled beyond 30 days.</p> : null}
        </div>
      )}
    </div>
  );
}

function TaskGroup({ title, rows, tone, edit, empty, showDay }: { title: string; rows: Row[]; tone?: "danger" | "warning"; edit: boolean; empty?: string; showDay?: boolean }) {
  return (
    <Card className={cn(tone === "danger" && "border-danger/40")}>
      <CardHeader title={<span className={cn(tone === "danger" && "text-danger")}>{title} <span className="font-normal text-muted">({rows.length})</span></span>} />
      {rows.length ? (
        <ul className="divide-y divide-border">
          {rows.map((t) => {
            const phone = t.contact?.phone ?? (t.company.mainPhoneStatus !== "INVALID" ? t.company.mainPhone : null);
            const href = telHref(phone);
            return (
              <li key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="w-36 shrink-0 text-sm">
                  <span className={cn("font-medium tabular-nums", tone === "danger" && "text-danger")}>
                    {formatDate(t.dueAt, showDay || tone === "danger" ? { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="outline">{TASK_TYPE_LABEL[t.type]}</Badge>
                    <Link href={`/leads/${t.company.id}`} className="font-medium hover:underline">{t.company.name}</Link>
                    <StageBadge stage={t.company.stage} />
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted">
                    {t.title !== TASK_TYPE_LABEL[t.type] ? `${t.title} · ` : ""}
                    {t.contact?.name ? `${t.contact.name} · ` : ""}
                    {t.notes ?? ""}
                    {t.assignee ? ` · ${t.assignee.name}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {href && (t.type === "CALLBACK" || t.type === "REENGAGE") ? (
                    <Button asChild size="sm" variant="secondary"><a href={href}><Phone /> {formatPhone(phone)}</a></Button>
                  ) : null}
                  {t.type === "EMAIL" ? <Button asChild size="sm" variant="secondary"><Link href={`/outreach/compose?lead=${t.company.id}`}>Write email</Link></Button> : null}
                  {edit ? <TaskActions taskId={t.id} /> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-muted">{empty}</p>
      )}
    </Card>
  );
}
