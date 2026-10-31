import { createHmac } from "node:crypto";
import { safeEqual } from "./crypto";
import { db, type Prisma } from "./db";
import { getSetting } from "./settings";

/**
 * Opt-outs. Once someone opts out (by the link in the email, by replying
 * "no thanks", or because the address bounced) their address goes on a
 * suppression list that outlives the prospect record, so deleting or
 * re-importing them can't start email again.
 */

type Tx = Prisma.TransactionClient;
export type SuppressionReason = "unsubscribe" | "reply" | "bounce";

const lower = (email: string) => email.trim().toLowerCase();

function secret(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) throw new Error("APP_ENCRYPTION_KEY is not set");
  return key;
}

const signature = (emailId: string) => createHmac("sha256", secret()).update(`unsubscribe:v1:${emailId}`).digest("base64url");

/** Link token for one sent email. Doesn't expire: an old email's link must keep working. */
export const unsubscribeToken = (emailId: string) => `${emailId}.${signature(emailId)}`;

export function readUnsubscribeToken(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const emailId = token.slice(0, dot);
  return safeEqual(token.slice(dot + 1), signature(emailId)) ? emailId : null;
}

export function unsubscribeUrl(emailId: string): string {
  const origin = (process.env.APP_ORIGIN ?? "").replace(/\/$/, "");
  return `${origin}/unsubscribe/${unsubscribeToken(emailId)}`;
}
export function oneClickUrl(emailId: string): string {
  const origin = (process.env.APP_ORIGIN ?? "").replace(/\/$/, "");
  return `${origin}/api/unsubscribe/${unsubscribeToken(emailId)}`;
}

export async function isSuppressed(email: string, tx: Tx = db): Promise<boolean> {
  return (await tx.emailSuppression.count({ where: { email: lower(email) } })) > 0;
}

/** Stops everything queued for an address: its sequence enrollments and unsent emails. */
export async function stopEmailsTo(email: string, reason: string, tx: Tx) {
  await tx.enrollment.updateMany({
    where: { toEmail: { equals: email, mode: "insensitive" }, status: { in: ["ACTIVE", "PAUSED"] } },
    data: { status: "STOPPED", stopReason: reason, nextStepDueAt: null },
  });
  await tx.emailMessage.updateMany({
    where: { toEmail: { equals: email, mode: "insensitive" }, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "FAILED"] } },
    data: { status: "CANCELLED", error: reason },
  });
}

/**
 * Honors an opt-out for an address. Marks the contacts with that address, and
 * the company if it was the company's main inbox. Safe to repeat. Returns
 * whether this was new, so history only records it once.
 */
export async function applyOptOut(email: string, reason: "unsubscribe" | "reply", companyId: string | null, tx: Tx): Promise<boolean> {
  const address = lower(email);
  const existing = await tx.emailSuppression.findUnique({ where: { email: address } });
  if (existing && existing.reason !== "bounce") return false;
  await tx.emailSuppression.upsert({ where: { email: address }, create: { email: address, reason, companyId }, update: { reason } });
  await tx.contact.updateMany({ where: { email: { equals: address, mode: "insensitive" } }, data: { doNotContact: true } });
  await tx.company.updateMany({ where: { mainEmail: { equals: address, mode: "insensitive" } }, data: { doNotContact: true } });
  await stopEmailsTo(address, reason === "unsubscribe" ? "Opted out by the link in the email" : "Opted out by replying", tx);
  if (companyId) {
    await tx.activity.create({
      data: {
        companyId,
        type: "UNSUBSCRIBED",
        summary: reason === "unsubscribe" ? `${address} opted out by the link in the email` : `${address} opted out by replying`,
      },
    });
  }
  return true;
}

export interface UnsubscribeView {
  /** Masked, so the page confirms which address without revealing it to whoever holds the link. */
  email: string;
  company: string;
  done: boolean;
}

function mask(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "this address";
  return `${local.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(local.length - 1, 6)))}@${domain}`;
}

export async function lookupUnsubscribe(token: string): Promise<UnsubscribeView | null> {
  const emailId = readUnsubscribeToken(token);
  if (!emailId) return null;
  const email = await db.emailMessage.findUnique({ where: { id: emailId }, select: { toEmail: true } });
  if (!email) return null;
  const outreach = await getSetting("outreach");
  return { email: mask(email.toEmail), company: outreach.companyName, done: await isSuppressed(email.toEmail) };
}

/** From the link or a mail app's one-click POST. */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  const emailId = readUnsubscribeToken(token);
  if (!emailId) return false;
  const email = await db.emailMessage.findUnique({ where: { id: emailId }, select: { toEmail: true, companyId: true } });
  if (!email) return false;
  await db.$transaction(async (tx) => {
    const created = await applyOptOut(email.toEmail, "unsubscribe", email.companyId, tx);
    if (created) {
      await tx.auditLog.create({ data: { action: "email.unsubscribe", entity: "company", entityId: email.companyId, meta: { emailId } } });
    }
  });
  return true;
}
