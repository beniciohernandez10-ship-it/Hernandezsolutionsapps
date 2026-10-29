import Link from "next/link";
import { ViewTransition } from "react";
import { requirePrincipal } from "@/lib/auth/current";
import { getTicket, listAssignableStaff, listDevices, listQueues } from "@/lib/tickets/service";
import { AppError } from "@/lib/errors";
import { notFound } from "next/navigation";
import { CATEGORY_LABEL, STATUS_LABEL, type Category, type Priority, type Status } from "@/lib/tickets/schemas";
import { ComplianceBadge, EmailBadge, InternalBadge, PriorityBadge, SlaBadge, StatusBadge } from "@/components/badges";
import { markRead } from "@/lib/notify/service";
import { config } from "@/lib/config";
import { attachmentsEnabled } from "@/lib/attachments/storage";
import { antivirusConfigured } from "@/lib/attachments/scan";
import { AttachmentPanel } from "./attachments";
import { TimeCard } from "./time";
import { FieldsCard } from "./fields";
import { ticketTime } from "@/lib/billing/service";
import { ApprovalCard, TaskList } from "./request";
import { HardwareCard } from "./hardware";
import { RelatedCard } from "./related";
import { SurveyCard } from "./survey";
import { IncidentCard } from "./incident";
import { incidentsForCustomer } from "@/lib/incidents/service";
import { problemsForCustomer } from "@/lib/problems/service";
import { ProblemCard } from "./problem";
import { listCanned } from "@/lib/productivity/service";
import { Time } from "@/components/time";
import { PageTransition } from "@/components/page-transition";
import { IconBack, IconCheck } from "@/components/icons";
import { ReplyBox, StatusControls, StaffControls, DeviceLinker } from "./controls";
import { AiTriageCard } from "./ai";
import { aiCustomers } from "@/lib/ai/service";

export const metadata = { title: "Ticket" };

const EVENT_TEXT: Record<string, (from: string | null, to: string | null) => string> = {
  created: () => "created this request",
  status_changed: (f, t) => `changed status from ${STATUS_LABEL[f as Status] ?? f} to ${STATUS_LABEL[t as Status] ?? t}`,
  reopened: () => "reopened this request",
  closed: () => "closed this request automatically",
  merged: (_f, t) => `merged this request into ${t}`,
  merged_from: (_f, t) => `merged ${t} into this request`,
  parent_set: (_f, t) => `linked this request to ${t}`,
  parent_cleared: () => "unlinked this request from its parent",
  auto_assigned: (_f, t) => `assigned this request by rule "${t}"`,
  incident_linked: () => "linked this request to a wider incident",
  incident_unlinked: () => "unlinked this request from a wider incident",
  problem_linked: () => "linked this request to a problem",
  problem_unlinked: () => "unlinked this request from a problem",
  assigned: (_f, t) => (t ? "changed the assignee" : "removed the assignee"),
  priority_changed: (f, t) => `changed priority from ${f} to ${t}`,
  device_linked: () => "linked a device",
  device_unlinked: () => "unlinked a device",
  approval_requested: () => "asked for approval",
  approved: () => "approved this request",
  rejected: () => "declined this request",
  task_completed: () => "completed a checklist task",
  alert_cleared: (_f, t) => `recorded that the monitoring alert cleared${t ? ` ("${t}")` : ""}`,
  alert_repeated: () => "recorded the alert again",
  queue_changed: (_f, t) => (t ? `moved this request to the ${t} queue` : "removed this request from its queue"),
  hardware_ordered: () => "ordered the hardware",
  hardware_received: (_f, t) => `received the hardware${t ? ` (${t})` : ""}`,
  hardware_delivered: (_f, t) => (t === "user_setup" ? "delivered the hardware" : "delivered and set up the hardware"),
  attachment_added: (_f, t) => (t === "internal" ? "added a file for technicians" : "added a file"),
  sla_warning: (_f, t) => `was warned: ${t === "first_response" ? "first response" : "resolution"} target is coming up`,
  sla_breached: (_f, t) => `recorded a missed ${t === "first_response" ? "first response" : "resolution"} target`,
};

function minutes(n: number) {
  if (n < 60) return `${n} min`;
  return `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ""}`;
}

export default async function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { principal } = await requirePrincipal(`/portal/tickets/${id}`);
  let t;
  try {
    t = await getTicket(principal, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const v = t.viewer;
  const [staff, queues, devices, canned, incidentOptions, problemOptions, aiOn, time] = await Promise.all([
    v.canAssign ? listAssignableStaff(principal, t.customerId) : Promise.resolve([]),
    v.canAssign ? listQueues(principal) : Promise.resolve([]),
    v.canLinkDevices ? listDevices(principal, t.customerId).then((d) => d.devices) : Promise.resolve([]),
    v.isStaff ? listCanned(principal, t.customerId) : Promise.resolve([]),
    v.isStaff && !t.incident ? incidentsForCustomer(principal, t.customerId) : Promise.resolve([]),
    v.isStaff && !t.problem ? problemsForCustomer(principal, t.customerId) : Promise.resolve([]),
    v.isStaff ? aiCustomers([t.customerId]).then((s) => s.has(t.customerId)) : Promise.resolve(false),
    v.isStaff ? ticketTime(principal, t.id) : Promise.resolve(null),
  ]);
  const linked = new Set(t.devices.map((d) => d.id));
  // Viewing a ticket clears its notifications.
  await markRead(principal, { ticketId: t.id }).catch(() => 0);
  const sla = t.slaDetail;
  const closeAfterDays = config().closeAfterDays;

  type Item = { at: string; kind: "message"; m: (typeof t.messages)[number] } | { at: string; kind: "event"; e: (typeof t.events)[number] };
  const timeline: Item[] = [
    ...t.messages.map((m) => ({ at: m.createdAt, kind: "message" as const, m })),
    ...t.events.filter((e) => e.kind !== "created").map((e) => ({ at: e.createdAt, kind: "event" as const, e })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <PageTransition>
      <p>
        <Link href="/portal/tickets" transitionTypes={["nav-back"]} className="subtle">
          <IconBack size={14} /> All tickets
        </Link>
      </p>
      {sp.created && (
        <div className="alert alert-success" role="status">
          <IconCheck />
          <div>
            <strong>Request #{t.number} submitted</strong>
            We&apos;ll reply here. You can add details at any time.
          </div>
        </div>
      )}
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <span className="ticket-number">#{t.number}</span> · {t.customerName}
          </p>
          <ViewTransition name={`ticket-title-${t.id}`} share="morph" default="none">
            <h1>{t.title}</h1>
          </ViewTransition>
          <div className="row">
            <StatusBadge status={t.status} />
            <PriorityBadge priority={t.priority as Priority} />
            {t.kind === "request" && <span className="badge">Request</span>}
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="stack">
          <article className="message">
            <header>
              <strong>{t.requesterName}</strong>
              <span className="subtle"><Time iso={t.createdAt} mode="absolute" /></span>
            </header>
            {t.requestData ? (
              <dl className="kv request-answers">
                {t.requestData
                  .filter((a) => a.value)
                  .map((a, i) => (
                    <div key={i} className="kv-row">
                      <dt>{a.label}</dt>
                      <dd className="prewrap">{a.value}</dd>
                    </div>
                  ))}
              </dl>
            ) : (
              <div className="body">{t.description}</div>
            )}
          </article>

          {t.resolutionNote && (
            <section className="card resolution" aria-labelledby="resolution-h">
              <h2 id="resolution-h" className="eyebrow">
                {t.status === "closed" ? "Closed" : "Resolved"}
                {t.resolvedAt && <> · <Time iso={t.resolvedAt} mode="absolute" /></>}
              </h2>
              <p className="prewrap">{t.resolutionNote}</p>
              {t.status === "resolved" && t.resolvedAt && (
                <p className="subtle">
                  Closes automatically on <Time iso={new Date(new Date(t.resolvedAt).getTime() + closeAfterDays * 86400000).toISOString()} mode="absolute" />. Reply before then if it isn&apos;t fixed.
                </p>
              )}
            </section>
          )}

          <section aria-labelledby="conv-h">
            <h2 id="conv-h" className="sr-only">Conversation</h2>
            <ol className="timeline">
              {timeline.map((item) =>
                item.kind === "message" ? (
                  <li key={item.m.id}>
                    <article className={`message${item.m.authorIsStaff ? " staff" : ""}${item.m.visibility === "internal" ? " internal" : ""}`}>
                      <header>
                        <strong>{item.m.authorName}</strong>
                        {item.m.authorIsStaff && <span className="subtle">Hernandez Solutions</span>}
                        {item.m.visibility === "internal" && <InternalBadge />}
                        {item.m.source === "email" && <EmailBadge />}
                        <span className="subtle"><Time iso={item.m.createdAt} /></span>
                      </header>
                      {/* Rendered as text: React escapes it, and no HTML from users or providers is ever injected. */}
                      <div className="body">{item.m.body}</div>
                    </article>
                  </li>
                ) : (
                  <li key={`${item.e.kind}-${item.at}`} className="event">
                    {item.e.actorName ?? (item.e.kind.startsWith("sla_") || item.e.kind === "auto_assigned" || item.e.kind === "closed" ? "The IT Center" : "Someone")} {EVENT_TEXT[item.e.kind]?.(item.e.fromValue, item.e.toValue) ?? item.e.kind} · <Time iso={item.at} />
                  </li>
                ),
              )}
            </ol>
          </section>

          {v.canReply ? (
            <ReplyBox
              ticketId={t.id}
              canInternal={v.canAddInternalNote}
              resolved={t.status === "resolved"}
              closed={t.status === "closed"}
              canned={canned}
              fill={{ requesterName: t.requesterName, ticketNumber: t.number, technicianName: principal.displayName }}
              ai={aiOn}
            />
          ) : (
            <p className="alert alert-warning">
              <span>
                This request is closed. If you still need help, <Link href="/portal/tickets/new">open a new request</Link> and mention #{t.number}.
              </span>
            </p>
          )}
        </div>

        <aside className="stack" aria-label="Ticket details">
          {aiOn && <AiTriageCard ticketId={t.id} version={t.version} priority={t.priority} category={t.category} />}
          <IncidentCard ticketId={t.id} incident={t.incident} options={incidentOptions} canEdit={v.isStaff} />
          {v.isStaff && <ProblemCard ticketId={t.id} problem={t.problem} options={problemOptions} />}
          <SurveyCard ticketId={t.id} survey={t.survey} canRate={v.canRate} staff={v.isStaff} />
          {t.approval && <ApprovalCard ticketId={t.id} approval={t.approval} />}
          {t.hardware && (
            <HardwareCard
              ticketId={t.id}
              hardware={t.hardware}
              requested={t.requestData?.find((a) => /what do you need/i.test(a.label))?.value ?? null}
            />
          )}
          <section className="card tight">
            <h2 className="eyebrow">Details</h2>
            <dl className="kv">
              <dt>Status</dt>
              <dd>{STATUS_LABEL[t.status]}</dd>
              <dt>Category</dt>
              <dd>{CATEGORY_LABEL[t.category as Category] ?? t.category}</dd>
              <dt>Requester</dt>
              <dd>{t.requesterName}</dd>
              <dt>Assigned to</dt>
              <dd>{t.assigneeName ?? (t.queueName ? `${t.queueName} queue` : "Not assigned yet")}</dd>
              <dt>Created</dt>
              <dd><Time iso={t.createdAt} mode="absolute" /></dd>
              <dt>Last update</dt>
              <dd><Time iso={t.updatedAt} /></dd>
              <dt>First response</dt>
              <dd>{t.firstResponseAt ? <Time iso={t.firstResponseAt} mode="absolute" /> : "Not yet"}</dd>
              {t.resolvedAt && (
                <>
                  <dt>Resolved</dt>
                  <dd><Time iso={t.resolvedAt} mode="absolute" /></dd>
                </>
              )}
            </dl>
          </section>
          <FieldsCard ticketId={t.id} fields={t.fields} canEdit={v.isStaff} />
          {sla && (
            <section className="card tight" aria-labelledby="sla-h">
              <h2 id="sla-h" className="eyebrow">Service level · technicians only</h2>
              <dl className="kv">
                <dt>Policy</dt>
                <dd>{sla.policyName}</dd>
                <dt>First response</dt>
                <dd className="stack-tight">
                  <SlaBadge state={sla.firstResponse.state} />
                  <span className="subtle">
                    {sla.firstResponse.respondedAt ? <>Responded <Time iso={sla.firstResponse.respondedAt} mode="absolute" /></> : <>Due <Time iso={sla.firstResponse.dueAt} mode="absolute" /></>}
                  </span>
                </dd>
                <dt>Resolution</dt>
                <dd className="stack-tight">
                  <SlaBadge state={sla.resolution.state} />
                  <span className="subtle">
                    {sla.resolution.resolvedAt ? <>Resolved <Time iso={sla.resolution.resolvedAt} mode="absolute" /></> : <>Due <Time iso={sla.resolution.dueAt} mode="absolute" /></>}
                    {sla.resolution.pausedMinutes > 0 && ` · paused ${minutes(sla.resolution.pausedMinutes)} of business time`}
                  </span>
                </dd>
              </dl>
            </section>
          )}
          <RelatedCard ticketId={t.id} related={t.related} staff={v.isStaff} mergeable={!t.related.mergedInto && t.status !== "closed"} />
          {t.kind === "request" && <TaskList ticketId={t.id} tasks={t.tasks} canEdit={v.isStaff && t.approvalStatus !== "pending" && t.approvalStatus !== "rejected"} />}
          <AttachmentPanel
            ticketId={t.id}
            attachments={t.attachments}
            canUpload={v.canReply}
            canInternal={v.canAddInternalNote}
            enabled={attachmentsEnabled()}
            antivirus={antivirusConfigured()}
          />
          {time && <TimeCard ticketId={t.id} entries={time.entries} totalMinutes={time.totalMinutes} billableMinutes={time.billableMinutes} />}
          {v.canChangeStatus.length > 0 && <StatusControls ticketId={t.id} version={t.version} status={t.status} options={v.canChangeStatus} staff={v.isStaff} />}
          {v.canAssign && (
            <StaffControls ticketId={t.id} version={t.version} assigneeUserId={t.assigneeUserId} queueId={t.queueId} priority={t.priority} staff={staff} queues={queues} />
          )}
          {v.canLinkDevices && (
            <section className="card tight">
              <h2 className="eyebrow">Devices</h2>
              {t.devices.length === 0 ? (
                <p className="subtle">No devices linked.</p>
              ) : (
                <ul className="stack" role="list">
                  {t.devices.map((d) => (
                    <li key={d.id} className="spread">
                      <span>{d.name}</span>
                      <ComplianceBadge state={d.complianceState} />
                    </li>
                  ))}
                </ul>
              )}
              <DeviceLinker ticketId={t.id} devices={devices.filter((d) => !linked.has(d.id)).map((d) => ({ id: d.id, name: d.name }))} />
            </section>
          )}
        </aside>
      </div>
    </PageTransition>
  );
}
