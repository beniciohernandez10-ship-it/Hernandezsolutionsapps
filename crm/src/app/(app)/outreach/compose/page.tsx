import { Search } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Composer } from "@/components/outreach/composer";
import { OutreachNav } from "@/components/outreach/subnav";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { canWrite } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { INDUSTRY_LABEL } from "@/lib/constants";
import { db } from "@/lib/db";
import { mailProvider } from "@/lib/mail";
import { firstTouchTemplate } from "@/lib/outreach";
import { getSetting } from "@/lib/settings";
import { BUILT_IN_TEMPLATES, emailFooter } from "@/lib/templates";

export const metadata = { title: "Write an email" };

export default async function ComposePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("SALES");
  const sp = await searchParams;
  const email = sp.email ? await db.emailMessage.findUnique({ where: { id: sp.email } }) : null;
  if (sp.email && !email) notFound();
  const leadId = email?.companyId ?? sp.lead;

  if (!leadId) {
    const q = sp.q?.trim().slice(0, 100);
    const results = q
      ? await db.company.findMany({
          where: { archived: false, OR: [{ name: { contains: q, mode: "insensitive" } }, { contacts: { some: { name: { contains: q, mode: "insensitive" } } } }] },
          select: { id: true, name: true, city: true, industry: true, mainEmail: true, contacts: { where: { email: { not: null } }, select: { id: true }, take: 1 } },
          take: 25,
          orderBy: { name: "asc" },
        })
      : [];
    return (
      <div>
        <PageHeader title="Write an email" description="Pick a prospect to write to." />
        <OutreachNav active="/outreach/compose" />
        <form className="mb-4 flex max-w-lg gap-2" action="/outreach/compose">
          <Input name="q" defaultValue={q} placeholder="Search prospects or contacts" autoFocus />
          <Button type="submit" variant="primary"><Search /> Search</Button>
        </form>
        {q && !results.length ? <EmptyState title="No prospects match">Try another name.</EmptyState> : null}
        {results.length ? (
          <Card>
            <ul className="divide-y divide-border">
              {results.map((r) => (
                <li key={r.id}>
                  <Link href={`/outreach/compose?lead=${r.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2">
                    <span><span className="font-medium">{r.name}</span> <span className="text-muted">· {INDUSTRY_LABEL[r.industry]}{r.city ? ` · ${r.city}` : ""}</span></span>
                    <span className="text-xs text-muted">{r.mainEmail || r.contacts.length ? "Has email" : "No email on file"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    );
  }

  const company = await db.company.findUnique({
    where: { id: leadId },
    select: {
      id: true, name: true, city: true, industry: true, personalNote: true, mainEmail: true, mainEmailStatus: true, doNotContact: true, contactFormUrl: true,
      contacts: { orderBy: [{ isPrimary: "desc" }, { isDecisionMaker: "desc" }], select: { id: true, name: true, title: true, email: true, emailStatus: true, doNotContact: true } },
      enrollments: { where: { status: { in: ["ACTIVE", "PAUSED"] } }, select: { sequence: { select: { name: true } } } },
    },
  });
  if (!company) notFound();
  const [outreach, templateRows, sequences, suggested] = await Promise.all([
    getSetting("outreach"),
    db.template.findMany({ where: { channel: "EMAIL", active: true }, orderBy: [{ builtInKey: { sort: "asc", nulls: "first" } }, { name: "asc" }], select: { id: true, name: true, industries: true, subject: true, body: true } }),
    db.sequence.findMany({ where: { active: true }, select: { id: true, name: true, _count: { select: { steps: true } } }, orderBy: { name: "asc" } }),
    firstTouchTemplate(company.industry),
  ]);
  const templates = templateRows.length
    ? templateRows
    : BUILT_IN_TEMPLATES.filter((t) => t.channel === "EMAIL").map((t) => ({ id: `builtin:${t.key}`, name: t.name, industries: t.industries, subject: t.subject, body: t.body }));

  return (
    <div>
      <PageHeader title={`Email ${company.name}`} description="Edit anything before it goes out. Nothing is sent until you approve it." />
      <OutreachNav active="/outreach/compose" />
      <Composer
        company={{ id: company.id, name: company.name, city: company.city, industry: company.industry, industryLabel: INDUSTRY_LABEL[company.industry] ?? "", personalNote: company.personalNote, doNotContact: company.doNotContact, contactFormUrl: company.contactFormUrl }}
        recipients={[
          ...company.contacts.filter((c) => c.email && c.emailStatus !== "INVALID" && !c.doNotContact).map((c) => ({ contactId: c.id, name: c.name, title: c.title, email: c.email!, status: c.emailStatus })),
          ...(company.mainEmail && company.mainEmailStatus !== "INVALID" ? [{ contactId: null, name: "Company inbox", title: null, email: company.mainEmail, status: company.mainEmailStatus }] : []),
        ]}
        contactsWithoutEmail={company.contacts.filter((c) => !c.email).map((c) => c.name)}
        templates={templates}
        suggestedTemplateId={suggested.id ?? templates.find((t) => t.industries.includes(company.industry))?.id ?? templates[0]?.id ?? null}
        sender={{ senderName: outreach.senderName, senderCompany: outreach.companyName, website: outreach.website, senderPhone: outreach.senderPhone }}
        footer={emailFooter(outreach)}
        sequences={sequences.map((s) => ({ id: s.id, name: s.name, steps: s._count.steps }))}
        activeSequence={company.enrollments[0]?.sequence.name ?? null}
        existing={email ? { id: email.id, contactId: email.contactId, toEmail: email.toEmail, subject: email.subject, body: email.body, templateId: email.templateId, status: email.status } : null}
        initialContactId={sp.contact ?? null}
        provider={mailProvider()}
        canEdit={canWrite(user.role)}
      />
    </div>
  );
}
