import { UNTOUCHED_STAGES, CLOSED_STAGES, type StageKey } from "./constants";
import { db, type Prisma } from "./db";
import { deliver, fullBody, sendBlockers, sentToday } from "./mail";
import { changeStage } from "./leads/service";
import { getSetting, type OutreachSettings } from "./settings";
import { BUILT_IN_TEMPLATES, FOLLOW_UP_KEYS, builtInKeyForIndustry, mergeDataFor, renderTemplate } from "./templates";

type Tx = Prisma.TransactionClient;

export interface TemplateContent {
  id: string | null;
  subject: string;
  body: string;
}

/** A built-in template from the database (as edited) or, if not seeded yet, from the code. */
export async function builtInTemplate(key: string, tx: Tx = db): Promise<TemplateContent> {
  const row = await tx.template.findUnique({ where: { builtInKey: key } });
  if (row?.active) return { id: row.id, subject: row.subject, body: row.body };
  const t = BUILT_IN_TEMPLATES.find((b) => b.key === key) ?? BUILT_IN_TEMPLATES.find((b) => b.key === "general")!;
  return { id: row?.id ?? null, subject: t.subject, body: t.body };
}

/** First-touch template for a lead: a user template for its industry wins over the built-in one. */
export async function firstTouchTemplate(industry: string, tx: Tx = db): Promise<TemplateContent> {
  const custom = await tx.template.findFirst({
    where: { channel: "EMAIL", active: true, builtInKey: null, industries: { has: industry } },
    orderBy: { updatedAt: "desc" },
  });
  if (custom) return { id: custom.id, subject: custom.subject, body: custom.body };
  return builtInTemplate(builtInKeyForIndustry(industry), tx);
}

export async function renderFor(
  template: { subject: string; body: string },
  companyId: string,
  contactId: string | null,
  outreach?: OutreachSettings,
  tx: Tx = db,
) {
  const o = outreach ?? (await getSetting("outreach"));
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, city: true, industry: true, personalNote: true } });
  const contact = contactId ? await tx.contact.findUnique({ where: { id: contactId }, select: { name: true, title: true } }) : null;
  const data = mergeDataFor({ company, contact, sender: o });
  return { subject: renderTemplate(template.subject, data), body: renderTemplate(template.body, data) };
}

/** Best email for a lead: chosen contact, then primary/decision-maker contacts, then the company inbox. */
export async function recipientFor(companyId: string, contactId?: string | null, tx: Tx = db): Promise<{ email: string | null; contactId: string | null }> {
  if (contactId) {
    const c = await tx.contact.findUnique({ where: { id: contactId }, select: { id: true, email: true, emailStatus: true, doNotContact: true } });
    if (c?.email && c.emailStatus !== "INVALID" && !c.doNotContact) return { email: c.email, contactId: c.id };
  }
  const c = await tx.contact.findFirst({
    where: { companyId, email: { not: null }, emailStatus: { not: "INVALID" }, doNotContact: false },
    orderBy: [{ isPrimary: "desc" }, { isDecisionMaker: "desc" }, { createdAt: "asc" }],
    select: { id: true, email: true },
  });
  if (c?.email) return { email: c.email, contactId: c.id };
  const co = await tx.company.findUnique({ where: { id: companyId }, select: { mainEmail: true, mainEmailStatus: true } });
  if (co?.mainEmail && co.mainEmailStatus !== "INVALID") return { email: co.mainEmail, contactId: null };
  return { email: null, contactId: null };
}

// ---------------------------------------------------------------------------
// Sequences: drafts only. A drafted step waits in the approval queue; nothing sends by itself.
// ---------------------------------------------------------------------------

async function templateForStep(step: { order: number; templateId: string | null }, industry: string, tx: Tx): Promise<TemplateContent> {
  if (step.templateId) {
    const t = await tx.template.findUnique({ where: { id: step.templateId } });
    if (t?.active) return { id: t.id, subject: t.subject, body: t.body };
  }
  if (step.order === 1) return firstTouchTemplate(industry, tx);
  const key = FOLLOW_UP_KEYS[Math.min(step.order - 2, FOLLOW_UP_KEYS.length - 1)];
  return builtInTemplate(key, tx);
}

export interface AdvanceResult {
  drafted: number;
  stopped: number;
  completed: number;
}

/** Draft the next step for every active enrollment that is due. Safe to run any number of times. */
export async function advanceEnrollments(now = new Date()): Promise<AdvanceResult> {
  const result: AdvanceResult = { drafted: 0, stopped: 0, completed: 0 };
  const outreach = await getSetting("outreach");
  const due = await db.enrollment.findMany({
    where: { status: "ACTIVE", nextStepDueAt: { lte: now } },
    include: { sequence: { include: { steps: { orderBy: { order: "asc" } } } }, company: { select: { industry: true, stage: true, doNotContact: true, archived: true } } },
    take: 500,
  });
  for (const e of due) {
    await db.$transaction(async (tx) => {
      const stop = async (reason: string) => {
        await tx.enrollment.update({ where: { id: e.id }, data: { status: "STOPPED", stopReason: reason, nextStepDueAt: null } });
        result.stopped++;
      };
      if (e.company.doNotContact) return stop("Prospect marked Do not contact");
      if (e.company.archived) return stop("Prospect archived");
      if (CLOSED_STAGES.includes(e.company.stage as StageKey)) return stop("Deal closed");
      const open = await tx.emailMessage.count({ where: { enrollmentId: e.id, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENDING", "FAILED"] } } });
      if (open) {
        // The previous step hasn't gone out yet; wait for it.
        await tx.enrollment.update({ where: { id: e.id }, data: { nextStepDueAt: null } });
        return;
      }
      const step = e.sequence.steps.find((s) => s.order === e.currentStep + 1);
      if (!step) {
        await tx.enrollment.update({ where: { id: e.id }, data: { status: "COMPLETED", nextStepDueAt: null } });
        result.completed++;
        return;
      }
      const template = await templateForStep(step, e.company.industry, tx);
      const rendered = await renderFor(template, e.companyId, e.contactId, outreach, tx);
      const previous = step.sameThread
        ? await tx.emailMessage.findFirst({ where: { enrollmentId: e.id, status: "SENT" }, orderBy: { sentAt: "desc" } })
        : null;
      const subject = previous ? (/^re:/i.test(previous.subject) ? previous.subject : `Re: ${previous.subject}`) : rendered.subject;
      await tx.emailMessage.create({
        data: {
          companyId: e.companyId,
          contactId: e.contactId,
          enrollmentId: e.id,
          stepOrder: step.order,
          templateId: template.id,
          toEmail: e.toEmail,
          subject,
          body: rendered.body,
          status: "PENDING_APPROVAL",
          createdById: e.createdById,
          inReplyTo: previous?.providerMessageId ?? null,
        },
      });
      await tx.enrollment.update({ where: { id: e.id }, data: { currentStep: step.order, nextStepDueAt: null } });
      result.drafted++;
    });
  }
  return result;
}

/** After a sequence email goes out, schedule the next step (or finish the enrollment). */
async function scheduleNextStep(enrollmentId: string, sentAt: Date, tx: Tx) {
  const e = await tx.enrollment.findUnique({ where: { id: enrollmentId }, include: { sequence: { include: { steps: true } } } });
  if (!e || e.status !== "ACTIVE") return;
  const next = e.sequence.steps.find((s) => s.order === e.currentStep + 1);
  if (!next) {
    await tx.enrollment.update({ where: { id: e.id }, data: { status: "COMPLETED", nextStepDueAt: null } });
    return;
  }
  await tx.enrollment.update({ where: { id: e.id }, data: { nextStepDueAt: new Date(sentAt.getTime() + next.delayDays * 86400_000) } });
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

const SENDABLE = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "FAILED"] as const;

async function recordSent(
  email: { id: string; companyId: string; contactId: string | null; enrollmentId: string | null; subject: string; toEmail: string },
  userId: string,
  via: string,
  messageId: string | null,
) {
  const sentAt = new Date();
  await db.$transaction(async (tx) => {
    await tx.emailMessage.update({
      where: { id: email.id },
      data: { status: "SENT", sentAt, sentVia: via, providerMessageId: messageId, approvedById: userId, approvedAt: sentAt, error: null },
    });
    await tx.activity.create({
      data: {
        companyId: email.companyId,
        contactId: email.contactId,
        userId,
        type: "EMAIL_SENT",
        summary: `Email sent: ${email.subject}`,
        meta: { emailId: email.id, to: email.toEmail, via },
      },
    });
    const company = await tx.company.update({ where: { id: email.companyId }, data: { emailCount: { increment: 1 }, lastContactedAt: sentAt }, select: { stage: true } });
    if (UNTOUCHED_STAGES.includes(company.stage as StageKey)) await changeStage(email.companyId, "ATTEMPTED_CONTACT", userId, "First email sent", tx);
    if (email.enrollmentId) await scheduleNextStep(email.enrollmentId, sentAt, tx);
  });
}

export type SendOutcome = { ok: true; via: string } | { ok: false; error: string };

/**
 * Approve and send one email. Called only from a person's click. The status flip to SENDING is
 * atomic, so double clicks or two people approving at once can't send it twice.
 */
export async function approveAndSend(emailId: string, userId: string): Promise<SendOutcome> {
  const email = await db.emailMessage.findUnique({ where: { id: emailId } });
  if (!email) return { ok: false, error: "That email no longer exists." };
  if (!SENDABLE.includes(email.status as (typeof SENDABLE)[number])) return { ok: false, error: `This email is already ${email.status.toLowerCase()}.` };
  const outreach = await getSetting("outreach");
  const blockers = await sendBlockers(email, outreach);
  if (blockers.length) return { ok: false, error: blockers[0] };
  if ((await sentToday()) >= outreach.dailySendCap) {
    return { ok: false, error: `Today's sending limit (${outreach.dailySendCap}) is reached. It protects your sender reputation; raise it in Settings → Outreach if needed.` };
  }
  const claimed = await db.emailMessage.updateMany({ where: { id: email.id, status: { in: [...SENDABLE] } }, data: { status: "SENDING", approvedById: userId, approvedAt: new Date() } });
  if (!claimed.count) return { ok: false, error: "Someone else is already sending this email." };
  try {
    const { via, messageId } = await deliver({
      to: email.toEmail,
      subject: email.subject,
      text: fullBody(email.body, outreach),
      inReplyTo: email.inReplyTo,
      fromName: `${outreach.senderName} | ${outreach.companyName}`,
    });
    await recordSent(email, userId, via, messageId);
    return { ok: true, via };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sending failed.";
    await db.emailMessage.update({ where: { id: email.id }, data: { status: "FAILED", error: message.slice(0, 500) } });
    return { ok: false, error: message };
  }
}

/** For emails sent by hand from the user's own mail app. */
export async function markSentManually(emailId: string, userId: string): Promise<SendOutcome> {
  const email = await db.emailMessage.findUnique({ where: { id: emailId } });
  if (!email) return { ok: false, error: "That email no longer exists." };
  if (!SENDABLE.includes(email.status as (typeof SENDABLE)[number])) return { ok: false, error: `This email is already ${email.status.toLowerCase()}.` };
  await recordSent(email, userId, "manual", null);
  return { ok: true, via: "manual" };
}
