import {
  ArrowLeft, Ban, BadgeCheck, CalendarClock, ExternalLink, FileText, Globe, Link2, Mail, MapPin, Paperclip, PencilLine, Phone, Star,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PriorityBadge, ScoreBadge, StageBadge, VerificationIcon } from "@/components/badges";
import {
  AttachmentUpload, ContactDialog, DeleteLeadButton, ContactMenu, DeleteAttachment, LogCallButton, MarkReplyButton, NoteForm, QueueButton, ScoreAdjust, StageSelect, TaskActions,
  TaskDialog, VerifySelect,
} from "@/components/leads/detail-widgets";
import { ResearchPanel } from "@/components/leads/research-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, KeyValue } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canAdmin, canWrite } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import {
  ACTIVITY_LABEL, BUSINESS_STAGE_LABEL, CONTACT_METHOD_LABEL, EMAIL_STATUS_LABEL, ENROLLMENT_STATUS_LABEL, INDUSTRY_LABEL, REGION_LABEL,
  TASK_TYPE_LABEL,
} from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { annualValue, monthlyValue, num, probability, usd, weightedValue } from "@/lib/money";
import { formatPhone, telHref } from "@/lib/normalize";
import { researchConfigured } from "@/lib/research";
import type { FactorResult, ManualFactor } from "@/lib/scoring";
import { getSetting } from "@/lib/settings";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await db.company.findUnique({ where: { id }, select: { name: true } });
  return { title: c?.name ?? "Prospect" };
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const company = await db.company.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      activities: { orderBy: { occurredAt: "desc" }, take: 200, include: { user: { select: { name: true } }, contact: { select: { name: true } } } },
      tasks: { orderBy: { dueAt: "asc" }, include: { assignee: { select: { name: true } }, contact: { select: { name: true } } } },
      attachments: { select: { id: true, fileName: true, size: true, mimeType: true, createdAt: true }, orderBy: { createdAt: "desc" } },
      emails: { orderBy: { createdAt: "desc" }, take: 50 },
      enrollments: { include: { sequence: { select: { name: true } } }, orderBy: { startedAt: "desc" } },
      research: { orderBy: { retrievedAt: "desc" } },
      client: true,
      duplicateReviews: { where: { status: "OPEN" }, select: { id: true } },
    },
  });
  if (!company) notFound();
  const [users, sales] = await Promise.all([
    db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getSetting("sales"),
  ]);
  const editable = canWrite(user.role);
  const primary = company.contacts.find((c) => c.phone && c.phoneStatus !== "INVALID") ?? company.contacts[0];
  const dialPhone = primary?.phone && primary.phoneStatus !== "INVALID" ? primary.phone : company.mainPhoneStatus !== "INVALID" ? company.mainPhone : null;
  const tel = telHref(dialPhone);
  const breakdown = (company.scoreBreakdown ?? {}) as { manual?: Record<string, ManualFactor>; factors?: FactorResult[] };
  const openTasks = company.tasks.filter((t) => !t.completedAt);
  const doneTasks = company.tasks.filter((t) => t.completedAt);
  const now = Date.now();
  const deal = { ...company, stage: company.stage };
  const monthly = monthlyValue(deal, sales.pricePerUser);
  const contactList = company.contacts.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={company.industry === "veterinary" ? "/leads?view=veterinary" : "/leads"} className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
          <ArrowLeft className="size-3.5" /> Prospects
        </Link>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-muted">
              <Badge tone="outline">{INDUSTRY_LABEL[company.industry] ?? company.industry}</Badge>
              {company.subindustry ? <span className="text-xs">{company.subindustry}</span> : null}
              {company.businessStage === "STARTUP" ? <Badge tone="accent">Startup</Badge> : null}
              <PriorityBadge priority={company.priority} />
              <ScoreBadge score={company.score} estimate={company.scoreIsEstimate} />
              {company.doNotContact ? <Badge tone="danger"><Ban /> Do not contact</Badge> : null}
              {company.client ? <Badge tone="success"><BadgeCheck /> Client</Badge> : null}
              {company.archived ? <Badge tone="warning">Archived</Badge> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editable ? <StageSelect companyId={company.id} stage={company.stage} /> : <StageBadge stage={company.stage} />}
            {editable ? (
              <Button asChild variant="secondary"><Link href={`/leads/${company.id}/edit`}><PencilLine /> Edit</Link></Button>
            ) : null}
          </div>
        </div>
      </div>

      {company.duplicateReviews.length ? (
        <Alert tone="warning" title="Possible duplicate">
          An imported record may be the same business. <Link className="text-accent underline" href="/import/review">Review it</Link>.
        </Alert>
      ) : null}

      {editable ? (
        <div className="flex flex-wrap gap-2">
          {tel ? (
            <Button asChild variant="primary"><a href={tel}><Phone /> Call {formatPhone(dialPhone)}</a></Button>
          ) : null}
          <LogCallButton companyId={company.id} contacts={contactList} defaultContactId={primary?.id} phone={dialPhone} retryDays={sales.retryAfterNoAnswerDays} />
          {!company.doNotContact ? (
            <Button asChild variant="secondary"><Link href={`/outreach/compose?lead=${company.id}`}><Mail /> Write email</Link></Button>
          ) : null}
          <TaskDialog companyId={company.id} contacts={contactList} users={users} />
          <QueueButton companyId={company.id} />
          <MarkReplyButton companyId={company.id} />
          {!company.client && ["NEGOTIATION", "CONTRACT_SENT", "CLOSED_WON", "PROPOSAL_SENT"].includes(company.stage) ? (
            <Button asChild variant="subtle"><Link href={`/clients/convert/${company.id}`}><BadgeCheck /> Convert to client</Link></Button>
          ) : null}
          {company.client ? <Button asChild variant="subtle"><Link href={`/clients/${company.client.id}`}><BadgeCheck /> Open client record</Link></Button> : null}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-5">
          {openTasks.length ? (
            <Card>
              <CardHeader title="Open follow-ups" />
              <ul className="divide-y divide-border">
                {openTasks.map((t) => {
                  const overdue = t.dueAt.getTime() < now;
                  return (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{t.title}</p>
                        <p className={cn("text-xs", overdue ? "font-medium text-danger" : "text-muted")}>
                          <CalendarClock className="mr-1 inline size-3" />
                          {overdue ? "Overdue · " : ""}{formatDateTime(t.dueAt)} · {TASK_TYPE_LABEL[t.type]}
                          {t.contact ? ` · ${t.contact.name}` : ""}
                          {t.assignee ? ` · ${t.assignee.name}` : ""}
                        </p>
                        {t.notes ? <p className="mt-0.5 text-xs text-muted">{t.notes}</p> : null}
                      </div>
                      {editable ? <TaskActions taskId={t.id} /> : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardBody>
              <Tabs defaultValue="timeline">
                <TabsList>
                  <TabsTrigger value="timeline">Timeline ({company.activities.length})</TabsTrigger>
                  <TabsTrigger value="emails">Emails ({company.emails.length})</TabsTrigger>
                  <TabsTrigger value="meetings">Meetings &amp; follow-ups</TabsTrigger>
                  <TabsTrigger value="files">Files ({company.attachments.length})</TabsTrigger>
                  <TabsTrigger value="research">Research ({company.research.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="timeline">
                  {editable ? <div className="mb-5"><NoteForm companyId={company.id} /></div> : null}
                  {company.activities.length === 0 ? (
                    <p className="text-sm text-muted">Nothing here yet.</p>
                  ) : (
                    <ol className="relative flex flex-col gap-4 border-l border-border pl-5">
                      {company.activities.map((a) => (
                        <li key={a.id} className="relative">
                          <span className={cn("absolute -left-[25px] top-1 size-2.5 rounded-full border-2 border-surface", a.type === "CALL" ? "bg-accent" : a.type === "STAGE_CHANGE" ? "bg-warning" : a.type.startsWith("EMAIL") || a.type === "REPLY_RECEIVED" ? "bg-success" : "bg-subtle")} />
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-sm font-medium">{a.summary}</span>
                            {a.durationSec ? <span className="text-xs text-muted">{Math.round(a.durationSec / 60)} min</span> : null}
                            <span className="text-xs text-subtle">{formatDateTime(a.occurredAt)}{a.user ? ` · ${a.user.name}` : ""}{a.contact ? ` · ${a.contact.name}` : ""}</span>
                          </div>
                          {a.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-fg/80">{a.body}</p> : null}
                          {a.type !== "CALL" && a.type !== "NOTE" && a.type !== "STAGE_CHANGE" && !a.body ? <span className="text-xs text-subtle">{ACTIVITY_LABEL[a.type]}</span> : null}
                        </li>
                      ))}
                    </ol>
                  )}
                </TabsContent>

                <TabsContent value="emails">
                  {company.enrollments.length ? (
                    <div className="mb-4 flex flex-col gap-2">
                      {company.enrollments.map((e) => (
                        <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm">
                          <span className="font-medium">{e.sequence.name}</span>
                          <Badge tone={e.status === "ACTIVE" ? "accent" : e.status === "REPLIED" ? "success" : "neutral"}>{ENROLLMENT_STATUS_LABEL[e.status]}</Badge>
                          <span className="text-xs text-muted">to {e.toEmail} · step {e.currentStep}{e.nextStepDueAt && e.status === "ACTIVE" ? ` · next draft ${formatDate(e.nextStepDueAt)}` : ""}{e.stopReason ? ` · ${e.stopReason}` : ""}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {company.emails.length === 0 ? (
                    <p className="text-sm text-muted">No emails yet. Use <Link href={`/outreach/compose?lead=${company.id}`} className="text-accent hover:underline">Write email</Link> to draft one from a template.</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {company.emails.map((m) => (
                        <li key={m.id} className="rounded-md border border-border p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-medium">{m.subject}</span>
                            <Badge tone={m.status === "SENT" ? "success" : m.status === "FAILED" ? "danger" : m.status === "PENDING_APPROVAL" ? "warning" : "neutral"}>{EMAIL_STATUS_LABEL[m.status]}</Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-muted">To {m.toEmail} · {m.sentAt ? `sent ${formatDateTime(m.sentAt)}` : `created ${formatDateTime(m.createdAt)}`}{m.stepOrder ? ` · sequence step ${m.stepOrder}` : ""}</p>
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-accent">Show message</summary>
                            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-fg/80">{m.body}</pre>
                          </details>
                          {m.status === "DRAFT" || m.status === "PENDING_APPROVAL" ? (
                            <Link href={`/outreach?focus=${m.id}`} className="mt-2 inline-block text-xs text-accent hover:underline">Review in the approval queue</Link>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                <TabsContent value="meetings">
                  {doneTasks.length === 0 && company.activities.filter((a) => a.type === "MEETING").length === 0 ? (
                    <p className="text-sm text-muted">No completed follow-ups or meetings yet.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {doneTasks.map((t) => (
                        <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                          <span>{t.title} <span className="text-xs text-muted">· {TASK_TYPE_LABEL[t.type]}</span></span>
                          <span className="text-xs text-muted">Done {formatDate(t.completedAt)}</span>
                        </li>
                      ))}
                      {company.activities.filter((a) => a.type === "MEETING").map((a) => (
                        <li key={a.id} className="py-2 text-sm">
                          <span className="font-medium">{a.summary}</span> <span className="text-xs text-muted">{formatDateTime(a.occurredAt)}</span>
                          {a.body ? <p className="mt-1 whitespace-pre-wrap text-fg/80">{a.body}</p> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                <TabsContent value="files">
                  {editable ? <div className="mb-4"><AttachmentUpload companyId={company.id} /></div> : null}
                  {company.attachments.length === 0 ? (
                    <p className="text-sm text-muted">No files yet. Proposals, signed agreements and assessment reports go here.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {company.attachments.map((f) => (
                        <li key={f.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                          <a href={`/api/attachments/${f.id}`} className="flex min-w-0 items-center gap-2 text-accent hover:underline">
                            <Paperclip className="size-4 shrink-0" /> <span className="truncate">{f.fileName}</span>
                          </a>
                          <span className="flex items-center gap-2 text-xs text-muted">
                            {(f.size / 1024).toFixed(0)} KB · {formatDate(f.createdAt)}
                            {editable ? <DeleteAttachment id={f.id} name={f.fileName} /> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                <TabsContent value="research">
                  <ResearchPanel
                    companyId={company.id}
                    editable={editable}
                    aiEnabled={researchConfigured()}
                    findings={company.research.map((r) => ({ ...r, retrievedAt: r.retrievedAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null }))}
                  />
                </TabsContent>
              </Tabs>
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="Contacts"
              description={`${company.contacts.length} on record`}
              action={editable ? <ContactDialog companyId={company.id} /> : null}
            />
            <div className="divide-y divide-border">
              <div className="px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-subtle">Main business line</p>
                <div className="mt-1.5 flex flex-col gap-1.5 text-sm">
                  {company.mainPhone ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5"><Phone className="size-3.5 text-muted" />{telHref(company.mainPhone) ? <a className="text-accent hover:underline" href={telHref(company.mainPhone)!}>{formatPhone(company.mainPhone)}</a> : company.mainPhone}<VerificationIcon status={company.mainPhoneStatus} /></span>
                      {editable ? <VerifySelect target={{ kind: "company", id: company.id }} field="phone" status={company.mainPhoneStatus} /> : null}
                    </div>
                  ) : <span className="text-xs text-subtle">No main phone</span>}
                  {company.mainEmail ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5"><Mail className="size-3.5 shrink-0 text-muted" /><a className="truncate text-accent hover:underline" href={`mailto:${company.mainEmail}`}>{company.mainEmail}</a><VerificationIcon status={company.mainEmailStatus} /></span>
                      {editable ? <VerifySelect target={{ kind: "company", id: company.id }} field="email" status={company.mainEmailStatus} /> : null}
                    </div>
                  ) : <span className="text-xs text-subtle">No main email</span>}
                  {company.contactFormUrl ? (
                    <a className="flex items-center gap-1.5 text-accent hover:underline" href={company.contactFormUrl} target="_blank" rel="noreferrer noopener"><FileText className="size-3.5" /> Contact form</a>
                  ) : null}
                  <span className="text-xs text-muted">Preferred: {CONTACT_METHOD_LABEL[company.preferredContactMethod]}</span>
                </div>
              </div>
              {company.contacts.map((c) => (
                <div key={c.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        {c.name}
                        {c.isPrimary ? <Star className="size-3.5 fill-warning text-warning" aria-label="Primary contact" /> : null}
                        {c.isDecisionMaker ? <Badge tone="success">Decision-maker</Badge> : null}
                        {c.doNotContact ? <Badge tone="danger">Do not contact</Badge> : null}
                      </p>
                      {c.title ? <p className="text-xs text-muted">{c.title}</p> : null}
                    </div>
                    {editable ? <ContactMenu companyId={company.id} contact={c} /> : null}
                  </div>
                  <div className="mt-1.5 flex flex-col gap-1.5 text-sm">
                    {c.phone ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5"><Phone className="size-3.5 text-muted" />{telHref(c.phone) ? <a className="text-accent hover:underline" href={telHref(c.phone)!}>{formatPhone(c.phone)}</a> : c.phone}<VerificationIcon status={c.phoneStatus} /></span>
                        {editable ? <VerifySelect target={{ kind: "contact", id: c.id }} field="phone" status={c.phoneStatus} /> : null}
                      </div>
                    ) : null}
                    {c.email ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5"><Mail className="size-3.5 shrink-0 text-muted" /><a className="truncate text-accent hover:underline" href={`mailto:${c.email}`}>{c.email}</a><VerificationIcon status={c.emailStatus} /></span>
                        {editable ? <VerifySelect target={{ kind: "contact", id: c.id }} field="email" status={c.emailStatus} /> : null}
                      </div>
                    ) : null}
                    {c.linkedinUrl ? <a className="flex items-center gap-1.5 text-accent hover:underline" href={c.linkedinUrl} target="_blank" rel="noreferrer noopener"><Link2 className="size-3.5" /> LinkedIn</a> : null}
                    <span className="text-xs text-subtle">{[c.source && `Source: ${c.source}`, c.verifiedAt && `Verified ${formatDate(c.verifiedAt)}`].filter(Boolean).join(" · ")}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Company" />
            <CardBody className="py-2">
              <dl>
                <KeyValue label="Website">{company.website ? <a className="inline-flex items-center gap-1 text-accent hover:underline" href={company.website} target="_blank" rel="noreferrer noopener"><Globe className="size-3.5" />{company.domain ?? company.website}<ExternalLink className="size-3" /></a> : null}</KeyValue>
                <KeyValue label="Location">
                  {company.streetAddress || company.city || company.headquarters ? (
                    <span className="inline-flex items-start gap-1"><MapPin className="mt-0.5 size-3.5 shrink-0 text-muted" />{[company.streetAddress, [company.city, company.state].filter(Boolean).join(", "), company.zip].filter(Boolean).join(" · ") || company.headquarters}</span>
                  ) : null}
                </KeyValue>
                <KeyValue label="Region">{company.region ? REGION_LABEL[company.region] : null}</KeyValue>
                {company.headquarters && company.city ? <KeyValue label="Headquarters">{company.headquarters}</KeyValue> : null}
                {company.additionalLocations.length ? <KeyValue label="Other locations">{company.additionalLocations.join("; ")}</KeyValue> : null}
                <KeyValue label="Type">{BUSINESS_STAGE_LABEL[company.businessStage]}{company.fundingStage ? ` · ${company.fundingStage}` : ""}</KeyValue>
                <KeyValue label="Employees">{company.employeeCount !== null ? `${company.employeeCount}${company.employeeCountSource ? ` (${company.employeeCountSource})` : ""}` : null}</KeyValue>
                {company.ownershipType ? <KeyValue label="Ownership">{company.ownershipType}</KeyValue> : null}
                {company.growthIndicators ? <KeyValue label="Growth">{company.growthIndicators}</KeyValue> : null}
                <KeyValue label="Assigned to">{company.owner?.name}</KeyValue>
                <KeyValue label="Discovered">{formatDate(company.discoveredAt)}</KeyValue>
                <KeyValue label="Last contacted">{company.lastContactedAt ? formatDateTime(company.lastContactedAt) : "Not contacted"}</KeyValue>
                <KeyValue label="Calls / emails">{company.callCount} / {company.emailCount}</KeyValue>
                <KeyValue label="Source">{company.sourceUrl ? <a className="text-accent hover:underline" href={company.sourceUrl} target="_blank" rel="noreferrer noopener">{company.source ?? "Link"}</a> : company.source}</KeyValue>
                {company.tags.length ? <KeyValue label="Tags"><span className="flex flex-wrap gap-1">{company.tags.map((t) => <Link key={t} href={`/leads?tag=${encodeURIComponent(t)}&view=all`}><Badge tone="outline">{t}</Badge></Link>)}</span></KeyValue> : null}
              </dl>
              {company.personalNote ? <p className="mt-2 rounded-md bg-accent-soft px-3 py-2 text-sm"><span className="font-medium">Opening line:</span> {company.personalNote}</p> : null}
              {company.description ? <p className="mt-3 whitespace-pre-wrap text-sm text-fg/80">{company.description}</p> : null}
              {company.notes ? (
                <details className="mt-3" open={company.notes.length < 400}>
                  <summary className="cursor-pointer text-xs font-medium text-muted">Notes</summary>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-fg/80">{company.notes}</p>
                </details>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Opportunity estimate" description="Estimates only. Contracted revenue comes from client records." />
            <CardBody className="py-2">
              <dl>
                <KeyValue label="Managed users">{company.managedUsers ?? "Not estimated"}</KeyValue>
                <KeyValue label="Price per user">{usd(num(company.pricePerUser) ?? sales.pricePerUser, { cents: true })}{num(company.pricePerUser) === null ? " (default)" : ""}</KeyValue>
                <KeyValue label="Est. monthly">{monthly ? usd(monthly) : "—"}{num(company.monthlyValueOverride) !== null ? " (custom)" : ""}</KeyValue>
                <KeyValue label="Est. annual">{monthly ? usd(annualValue(deal, sales.pricePerUser)) : "—"}</KeyValue>
                <KeyValue label="Implementation fee">{usd(num(company.implementationFee))}</KeyValue>
                <KeyValue label="Close probability">{probability(deal)}%{company.closeProbability === null ? " (stage default)" : ""}</KeyValue>
                <KeyValue label="Weighted value">{usd(weightedValue(deal, sales.pricePerUser))}</KeyValue>
                <KeyValue label="Expected close">{formatDate(company.expectedCloseDate)}</KeyValue>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Lead score: ${company.score ?? "—"}${company.scoreIsEstimate ? " (estimate)" : ""}`} description="Each factor shows what it's based on. Set a factor once you've checked the evidence." />
            <ul className="divide-y divide-border">
              {(breakdown.factors ?? []).map((f) => (
                <li key={f.key} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span>{f.label}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums font-medium">{f.points}/{f.max}</span>
                      {editable ? <ScoreAdjust companyId={company.id} factor={f.key} label={f.label} max={f.max} current={breakdown.manual?.[f.key]} /> : null}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    <Badge tone={f.basis === "data" ? "accent" : f.basis === "manual" ? "success" : f.basis === "inferred" ? "warning" : "neutral"} className="mr-1">
                      {f.basis === "data" ? "From record" : f.basis === "manual" ? "Checked" : f.basis === "inferred" ? "Estimate" : "Unknown"}
                    </Badge>
                    {f.evidence}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          {canAdmin(user.role) ? (
            <div className="text-right"><DeleteLeadButton companyId={company.id} name={company.name} /></div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
