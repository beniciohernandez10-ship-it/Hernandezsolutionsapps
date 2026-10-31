import { dayKey, endOfDay } from "../dates";
import { db, Prisma } from "../db";
import { changeStage, syncNextFollowUp } from "../leads/service";
import { mailProvider, senderAddress } from "../mail";
import { applyOptOut, stopEmailsTo } from "../optout";
import { getSetting, setSetting } from "../settings";
import { bounceInfo, classifyMail, isOptOutReply, replyText, type InboundMail } from "./classify";
import { fetchRecentMail } from "./fetch";

/**
 * Turns mail in the sending mailbox into CRM history. Mail that doesn't relate
 * to a known prospect is ignored and nothing about it is kept. Each message is
 * handled once, however many times the mailbox is read.
 */

type Tx = Prisma.TransactionClient;

const CHECK_EVERY_MS = 15 * 60_000;
const FIRST_LOOK_BACK_MS = 3 * 86400_000;
const OVERLAP_MS = 86400_000;
const MATCH_WINDOW_MS = 180 * 86400_000;
const lower = (s: string) => s.trim().toLowerCase();

/** Stops a prospect's sequences and unsent sequence emails. Used for detected and hand-logged replies alike. */
export async function stopSequencesForReply(companyId: string, tx: Tx) {
  await tx.enrollment.updateMany({ where: { companyId, status: { in: ["ACTIVE", "PAUSED"] } }, data: { status: "REPLIED", stopReason: "Prospect replied", nextStepDueAt: null } });
  await tx.emailMessage.updateMany({
    where: { companyId, status: { in: ["PENDING_APPROVAL", "DRAFT"] }, enrollmentId: { not: null } },
    data: { status: "CANCELLED", error: "Sequence stopped: prospect replied" },
  });
  await tx.company.update({ where: { id: companyId }, data: { lastContactedAt: new Date() } });
}

const STAGES_BEFORE_CONTACT = ["NEW_LEAD", "RESEARCHING", "READY_TO_CONTACT", "ATTEMPTED_CONTACT"];

export async function moveToContacted(companyId: string, userId: string | null, tx: Tx) {
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { stage: true } });
  if (STAGES_BEFORE_CONTACT.includes(company.stage)) await changeStage(companyId, "CONTACTED", userId, "Prospect replied", tx);
}

/** Which prospect a reply belongs to: the email it answers, else the last email to that address, else a known contact. */
async function matchReply(m: InboundMail, tx: Tx) {
  const ids = [m.inReplyTo, ...m.references].filter((x): x is string => Boolean(x));
  if (ids.length) {
    const threaded = await tx.emailMessage.findFirst({ where: { providerMessageId: { in: ids }, status: "SENT" }, orderBy: { sentAt: "desc" }, select: { id: true, companyId: true, contactId: true, toEmail: true } });
    if (threaded) return threaded;
  }
  const since = new Date(m.receivedAt.getTime() - MATCH_WINDOW_MS);
  const last = await tx.emailMessage.findFirst({
    where: { toEmail: { equals: m.from, mode: "insensitive" }, status: "SENT", sentAt: { gte: since } },
    orderBy: { sentAt: "desc" },
    select: { id: true, companyId: true, contactId: true, toEmail: true },
  });
  if (last) return last;
  const contact = await tx.contact.findFirst({ where: { email: { equals: m.from, mode: "insensitive" } }, select: { id: true, companyId: true } });
  return contact ? { id: null, companyId: contact.companyId, contactId: contact.id, toEmail: m.from } : null;
}

async function respondTask(companyId: string, title: string, tx: Tx) {
  const open = await tx.task.findFirst({ where: { companyId, title, completedAt: null }, select: { id: true } });
  if (open) return;
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { ownerId: true } });
  await tx.task.create({ data: { companyId, assigneeId: company.ownerId, type: "EMAIL", title, dueAt: endOfDay(dayKey()) } });
  await syncNextFollowUp(companyId, tx);
}

async function handleBounce(m: InboundMail, tx: Tx) {
  const info = bounceInfo(m);
  if (!info.recipient) return null;
  const sent = await tx.emailMessage.findFirst({
    where: { toEmail: { equals: info.recipient, mode: "insensitive" }, status: "SENT" },
    orderBy: { sentAt: "desc" },
    select: { id: true, companyId: true, contactId: true },
  });
  if (!sent) return null;
  const detail = info.status ? ` (${info.status})` : "";
  if (!info.hard) {
    await tx.activity.create({ data: { companyId: sent.companyId, contactId: sent.contactId, type: "BOUNCED", summary: `Temporary delivery problem to ${info.recipient}${detail}` } });
    return { kind: "bounce_soft", companyId: sent.companyId, emailId: sent.id };
  }
  await tx.emailSuppression.upsert({ where: { email: info.recipient }, create: { email: info.recipient, reason: "bounce", companyId: sent.companyId }, update: {} });
  await tx.contact.updateMany({ where: { email: { equals: info.recipient, mode: "insensitive" } }, data: { emailStatus: "INVALID" } });
  await tx.company.updateMany({ where: { mainEmail: { equals: info.recipient, mode: "insensitive" } }, data: { mainEmailStatus: "INVALID" } });
  await stopEmailsTo(info.recipient, "The address bounced", tx);
  await tx.emailMessage.update({ where: { id: sent.id }, data: { error: `Bounced${detail}` } });
  await tx.activity.create({ data: { companyId: sent.companyId, contactId: sent.contactId, type: "BOUNCED", summary: `${info.recipient} bounced${detail}. Marked invalid; no more email will go to it.` } });
  await respondTask(sent.companyId, `Find a working email: ${info.recipient} bounced`, tx);
  return { kind: "bounce_hard", companyId: sent.companyId, emailId: sent.id };
}

async function handleReply(m: InboundMail, tx: Tx) {
  const match = await matchReply(m, tx);
  if (!match) return null;
  const kind = classifyMail(m);
  const base = { companyId: match.companyId, contactId: match.contactId };
  if (kind === "auto_reply") {
    await tx.activity.create({ data: { ...base, type: "NOTE", summary: `Automatic reply from ${m.from}`, body: replyText(m.text).slice(0, 1000) || null } });
    return { kind: "auto_reply", companyId: match.companyId, emailId: match.id };
  }
  const body = replyText(m.text).slice(0, 4000) || null;
  await tx.activity.create({ data: { ...base, type: "REPLY_RECEIVED", summary: `Reply from ${m.from}: ${m.subject.slice(0, 150)}`, body, meta: { detected: true } } });
  await stopSequencesForReply(match.companyId, tx);
  await moveToContacted(match.companyId, null, tx);
  if (isOptOutReply(m.text)) {
    await applyOptOut(m.from, "reply", match.companyId, tx);
    // A colleague answering on someone's behalf opts out the address we were emailing too.
    if (lower(match.toEmail) !== lower(m.from)) await applyOptOut(match.toEmail, "reply", match.companyId, tx);
    return { kind: "opt_out", companyId: match.companyId, emailId: match.id };
  }
  await respondTask(match.companyId, `Respond to reply from ${m.from}`, tx);
  return { kind: "reply", companyId: match.companyId, emailId: match.id };
}

export type Handled = "reply" | "auto_reply" | "opt_out" | "bounce_hard" | "bounce_soft" | "ignored" | "seen";

/** Handles one message. Its own transaction, so one bad message can't undo the others. */
export async function applyInbound(m: InboundMail): Promise<Handled> {
  if (senderAddress() && lower(senderAddress()!) === m.from) return "ignored";
  try {
    return await db.$transaction(async (tx) => {
      if (await tx.inboxMessage.findUnique({ where: { messageId: m.messageId } })) return "seen" as const;
      const result = classifyMail(m) === "bounce" ? await handleBounce(m, tx) : await handleReply(m, tx);
      if (!result) return "ignored" as const;
      await tx.inboxMessage.create({ data: { messageId: m.messageId, kind: result.kind, companyId: result.companyId, emailId: result.emailId, fromEmail: m.from, receivedAt: m.receivedAt } });
      return result.kind as Handled;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "seen";
    throw err;
  }
}

export interface SyncResult {
  skipped?: "no_mailbox" | "too_soon";
  read?: number;
  handled?: Partial<Record<Handled, number>>;
  error?: string;
}

/** Reads the mailbox and applies what's new. At most every 15 minutes unless forced. Never throws. */
export async function syncInbox(opts: { force?: boolean; now?: Date; fetcher?: typeof fetchRecentMail } = {}): Promise<SyncResult> {
  if (mailProvider() === "manual" && !opts.fetcher) return { skipped: "no_mailbox" };
  const now = opts.now ?? new Date();
  const state = await getSetting("inboxSync");
  if (!opts.force && state.lastRunAt && now.getTime() - new Date(state.lastRunAt).getTime() < CHECK_EVERY_MS) return { skipped: "too_soon" };
  await setSetting("inboxSync", { ...state, lastRunAt: now.toISOString() });
  const since = state.lastSuccessAt ? new Date(new Date(state.lastSuccessAt).getTime() - OVERLAP_MS) : new Date(now.getTime() - FIRST_LOOK_BACK_MS);
  try {
    const mail = await (opts.fetcher ?? fetchRecentMail)(since);
    const handled: Partial<Record<Handled, number>> = {};
    for (const m of mail) {
      const kind = await applyInbound(m);
      handled[kind] = (handled[kind] ?? 0) + 1;
    }
    const latest = await getSetting("inboxSync");
    await setSetting("inboxSync", { ...latest, lastSuccessAt: now.toISOString(), lastError: null });
    return { read: mail.length, handled };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : "The mailbox couldn't be read.";
    const latest = await getSetting("inboxSync");
    await setSetting("inboxSync", { ...latest, lastError: message });
    return { error: message };
  }
}
