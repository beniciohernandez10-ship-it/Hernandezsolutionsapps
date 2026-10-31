import Link from "next/link";
import { EmailList, type EmailRow } from "@/components/outreach/email-list";
import { OutreachNav } from "@/components/outreach/subnav";
import { Card } from "@/components/ui/card";
import { Alert, PageHeader, Stat } from "@/components/ui/misc";
import { canWrite } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { db, type Prisma } from "@/lib/db";
import { PROVIDER_LABEL, fullBody, mailProvider, mailtoHref, senderAddress, sentToday } from "@/lib/mail";
import { getSetting } from "@/lib/settings";
import { unresolvedPlaceholders } from "@/lib/templates";
import { cn } from "@/lib/utils";

export const metadata = { title: "Email Outreach" };

const TABS = [
  { key: "queue", label: "Waiting for approval", where: { status: { in: ["PENDING_APPROVAL", "APPROVED"] } } },
  { key: "drafts", label: "Drafts", where: { status: "DRAFT" } },
  { key: "failed", label: "Failed", where: { status: "FAILED" } },
  { key: "sent", label: "Sent", where: { status: "SENT" } },
  { key: "cancelled", label: "Cancelled", where: { status: "CANCELLED" } },
] as const;

export default async function OutreachPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const [outreach, counts, rows, today] = await Promise.all([
    getSetting("outreach"),
    Promise.all(TABS.map((t) => db.emailMessage.count({ where: t.where as Prisma.EmailMessageWhereInput }))),
    db.emailMessage.findMany({
      where: tab.where as Prisma.EmailMessageWhereInput,
      include: { company: { select: { id: true, name: true, doNotContact: true } }, contact: { select: { name: true } }, enrollment: { select: { sequence: { select: { name: true } } } } },
      orderBy: tab.key === "sent" ? { sentAt: "desc" } : { createdAt: "asc" },
      take: tab.key === "sent" || tab.key === "cancelled" ? 200 : 500,
    }),
    sentToday(),
  ]);
  const provider = mailProvider();
  const emails: EmailRow[] = rows.map((e) => ({
    id: e.id,
    status: e.status,
    company: e.company,
    contact: e.contact?.name ?? null,
    toEmail: e.toEmail,
    subject: e.subject,
    body: e.body,
    sequence: e.enrollment?.sequence.name ?? null,
    step: e.stepOrder,
    when: formatDateTime(e.sentAt ?? e.createdAt),
    sentVia: e.sentVia,
    error: e.error,
    placeholders: unresolvedPlaceholders(`${e.subject}\n${e.body}`),
    mailto: mailtoHref(e.toEmail, e.subject, fullBody(e.body, outreach, e.id)),
  }));

  return (
    <div>
      <PageHeader title="Email Outreach" description="Nothing is sent until you approve it. Sequence follow-ups are drafted here on schedule and wait for you." />
      <OutreachNav active="/outreach" />
      {!outreach.mailingAddress.trim() ? (
        <Alert tone="warning" title="Add your mailing address before sending" className="mb-4">
          US law (CAN-SPAM) requires a valid postal address in sales email. Add it in <Link href="/settings#outreach" className="underline">Settings → Outreach</Link>; sending is blocked until then.
        </Alert>
      ) : null}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4"><Stat label="Waiting for approval" value={counts[0]} tone={counts[0] ? "warning" : undefined} /></Card>
        <Card className="p-4"><Stat label="Sent today" value={`${today} / ${outreach.dailySendCap}`} hint="Daily limit protects your sender reputation" /></Card>
        <Card className="p-4"><Stat label="Sending from" value={<span className="text-base">{senderAddress() ?? "Not connected"}</span>} hint={PROVIDER_LABEL[provider]} /></Card>
        <Card className="p-4"><Stat label="Failed" value={counts[2]} tone={counts[2] ? "danger" : undefined} /></Card>
      </div>
      {provider === "manual" ? (
        <Alert tone="neutral" className="mb-4">
          No sending account is connected yet, so approved emails open in your own mail app and you mark them sent here. To send straight from the CRM, add GMAIL_USER and GMAIL_APP_PASSWORD in Vercel (see the setup guide).
        </Alert>
      ) : null}
      <div className="mb-3 flex flex-wrap gap-1.5 text-sm">
        {TABS.map((t, i) => (
          <Link key={t.key} href={t.key === "queue" ? "/outreach" : `/outreach?tab=${t.key}`} className={cn("rounded-full border px-3 py-1", tab.key === t.key ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-2")}>
            {t.label} <span className="text-muted">{counts[i]}</span>
          </Link>
        ))}
      </div>
      <EmailList emails={emails} tab={tab.key} provider={provider} canEdit={canWrite(user.role)} />
    </div>
  );
}
