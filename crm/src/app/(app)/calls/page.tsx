import { CallWorkspace, type QueueEntry } from "@/components/calls/call-workspace";
import { PageHeader } from "@/components/ui/misc";
import { canWrite } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { dayKey, endOfDay, formatDate, nextWorkday, startOfDay } from "@/lib/dates";
import { db } from "@/lib/db";
import { INDUSTRY_LABEL, TECH_INDUSTRIES } from "@/lib/constants";
import { formatPhone, telHref } from "@/lib/normalize";
import { getSetting } from "@/lib/settings";
import { renderTemplate } from "@/lib/templates";
import { BUILT_IN_TEMPLATES } from "@/lib/templates";

export const metadata = { title: "Call Center" };

export default async function CallsPage() {
  const user = await requireUser();
  const today = dayKey();
  const tomorrow = nextWorkday(today);
  const [items, callsToday, tomorrowCount, sales, outreach, scriptRows] = await Promise.all([
    db.callQueueItem.findMany({
      where: { userId: user.id, day: today },
      orderBy: { position: "asc" },
      include: {
        company: {
          select: {
            id: true, name: true, industry: true, subindustry: true, city: true, state: true, stage: true, priority: true, score: true, scoreIsEstimate: true,
            mainPhone: true, mainPhoneStatus: true, personalNote: true, notes: true, callCount: true, lastContactedAt: true, website: true, employeeCount: true,
            contacts: { where: { doNotContact: false }, orderBy: [{ isPrimary: "desc" }, { isDecisionMaker: "desc" }], select: { id: true, name: true, title: true, phone: true, phoneStatus: true, email: true, isDecisionMaker: true } },
            activities: { orderBy: { occurredAt: "desc" }, take: 4, select: { id: true, summary: true, body: true, occurredAt: true } },
            tasks: { where: { completedAt: null }, orderBy: { dueAt: "asc" }, take: 1, select: { title: true, notes: true, dueAt: true } },
          },
        },
      },
    }),
    db.activity.count({ where: { userId: user.id, type: "CALL", occurredAt: { gte: startOfDay(today), lt: endOfDay(today) } } }),
    db.callQueueItem.count({ where: { userId: user.id, day: tomorrow } }),
    getSetting("sales"),
    getSetting("outreach"),
    db.template.findMany({ where: { channel: "CALL_SCRIPT", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, body: true, builtInKey: true } }),
  ]);

  const sender = { senderName: outreach.senderName, senderCompany: outreach.companyName, website: outreach.website, senderPhone: outreach.senderPhone };
  const scripts = (scriptRows.length ? scriptRows : BUILT_IN_TEMPLATES.filter((t) => t.channel === "CALL_SCRIPT").map((t) => ({ id: t.key, name: t.name, body: t.body, builtInKey: t.key }))).map((s) => ({
    id: s.id,
    name: s.name,
    startup: s.builtInKey === "call-script-startup",
    body: renderTemplate(s.body, sender),
  }));

  const entries: QueueEntry[] = items.map((i) => {
    const c = i.company;
    const phones = [
      ...(c.mainPhone && c.mainPhoneStatus !== "INVALID" ? [{ label: "Main line", contactId: null, raw: c.mainPhone, display: formatPhone(c.mainPhone), href: telHref(c.mainPhone) }] : []),
      ...c.contacts
        .filter((ct) => ct.phone && ct.phoneStatus !== "INVALID")
        .map((ct) => ({ label: ct.name + (ct.title ? `, ${ct.title}` : ""), contactId: ct.id, raw: ct.phone!, display: formatPhone(ct.phone), href: telHref(ct.phone) })),
    ];
    return {
      id: i.id,
      status: i.status,
      outcome: i.outcome,
      reason: i.reason,
      contactId: i.contactId,
      company: {
        id: c.id,
        name: c.name,
        industry: INDUSTRY_LABEL[c.industry] ?? c.industry,
        isTech: TECH_INDUSTRIES.has(c.industry),
        subindustry: c.subindustry,
        location: [c.city, c.state].filter(Boolean).join(", "),
        stage: c.stage,
        priority: c.priority,
        score: c.score,
        scoreIsEstimate: c.scoreIsEstimate,
        personalNote: c.personalNote,
        notes: c.notes,
        callCount: c.callCount,
        lastContacted: c.lastContactedAt ? formatDate(c.lastContactedAt) : null,
        website: c.website,
        employeeCount: c.employeeCount,
        contacts: c.contacts.map((ct) => ({ id: ct.id, name: ct.name, title: ct.title, email: ct.email, isDecisionMaker: ct.isDecisionMaker })),
        recent: c.activities.map((a) => ({ id: a.id, summary: a.summary, body: a.body, when: formatDate(a.occurredAt, { month: "short", day: "numeric" }) })),
        nextTask: c.tasks[0] ? { title: c.tasks[0].title, notes: c.tasks[0].notes, due: formatDate(c.tasks[0].dueAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) } : null,
      },
      phones,
    };
  });

  return (
    <div>
      <PageHeader
        title="Daily Call Center"
        description={`${formatDate(new Date(), { weekday: "long", month: "long", day: "numeric" })}. Work through the queue at lunch; every outcome is saved to the prospect's timeline.`}
      />
      <CallWorkspace
        entries={entries}
        callsToday={callsToday}
        goal={user.dailyCallGoal}
        tomorrowCount={tomorrowCount}
        tomorrowLabel={formatDate(new Date(`${tomorrow}T12:00:00Z`), { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}
        retryDays={sales.retryAfterNoAnswerDays}
        scripts={scripts}
        canEdit={canWrite(user.role)}
      />
    </div>
  );
}
