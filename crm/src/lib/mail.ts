import nodemailer, { type Transporter } from "nodemailer";
import { dayKey, startOfDay } from "./dates";
import { db } from "./db";
import { isSuppressed, oneClickUrl, unsubscribeUrl } from "./optout";
import { getSetting, type OutreachSettings } from "./settings";
import { emailFooter, unresolvedPlaceholders } from "./templates";

/**
 * Outgoing email. Nothing here runs on its own: every send starts from a person clicking
 * Approve & send (or Send) in Email Outreach.
 *
 * Providers, in order of preference when configured:
 * - Microsoft Graph (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER) for a future
 *   Microsoft 365 mailbox on the company domain.
 * - Gmail SMTP (GMAIL_USER, GMAIL_APP_PASSWORD) — the current sending address.
 * - Neither: emails can still be approved and opened in the user's own mail app, then marked sent.
 */

export type MailProvider = "graph" | "gmail" | "manual";

export function mailProvider(): MailProvider {
  if (process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_SENDER) return "graph";
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) return "gmail";
  return "manual";
}

export function senderAddress(): string | null {
  const p = mailProvider();
  if (p === "graph") return process.env.MS_SENDER ?? null;
  if (p === "gmail") return process.env.GMAIL_USER ?? null;
  return null;
}

export const PROVIDER_LABEL: Record<MailProvider, string> = {
  graph: "Microsoft 365 (Graph)",
  gmail: "Gmail",
  manual: "Your own email app (not connected)",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Reasons this email can't be sent right now. Empty means it can go. */
export async function sendBlockers(
  email: { toEmail: string; subject: string; body: string; companyId: string; contactId: string | null },
  outreach?: OutreachSettings,
): Promise<string[]> {
  const o = outreach ?? (await getSetting("outreach"));
  const problems: string[] = [];
  if (!o.mailingAddress.trim()) problems.push("Add your business mailing address in Settings → Outreach. US law (CAN-SPAM) requires it in sales email.");
  if (!EMAIL_RE.test(email.toEmail)) problems.push("The recipient address isn't a valid email.");
  else if (await isSuppressed(email.toEmail)) problems.push("This address opted out or bounced, so it can't get sales email.");
  if (!email.subject.trim()) problems.push("The subject is empty.");
  const ph = unresolvedPlaceholders(`${email.subject}\n${email.body}`);
  if (ph.length) problems.push(`Fill in or remove: ${ph.join(", ")}`);
  const company = await db.company.findUnique({ where: { id: email.companyId }, select: { doNotContact: true, archived: true } });
  if (!company) problems.push("This prospect no longer exists.");
  else if (company.doNotContact) problems.push("This prospect is marked Do not contact.");
  if (email.contactId) {
    const c = await db.contact.findUnique({ where: { id: email.contactId }, select: { doNotContact: true, emailStatus: true } });
    if (c?.doNotContact) problems.push("This contact is marked Do not contact.");
    if (c?.emailStatus === "INVALID") problems.push("This contact's email is marked invalid.");
  }
  return problems;
}

export async function sentToday(): Promise<number> {
  return db.emailMessage.count({ where: { status: "SENT", sentVia: { not: "manual" }, sentAt: { gte: startOfDay(dayKey()) } } });
}

/** The email as sent. With an email id, the footer has that email's unsubscribe link. */
export function fullBody(body: string, o: OutreachSettings, emailId?: string): string {
  const link = emailId && process.env.APP_ENCRYPTION_KEY ? `\nUnsubscribe: ${unsubscribeUrl(emailId)}` : "";
  return `${body.trim()}\n${emailFooter(o)}${link}\n`;
}

/** RFC 8058: mail apps show their own Unsubscribe button and POST to this address. */
export const unsubscribeHeaders = (emailId: string): Record<string, string> => ({
  "List-Unsubscribe": `<${oneClickUrl(emailId)}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
});

interface Outgoing {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string | null;
  fromName: string;
  /** Gmail only: Microsoft Graph refuses headers that don't start with x-, so its emails rely on the link in the body. */
  headers?: Record<string, string>;
}

let transport: Transporter | null = null;
function gmail() {
  transport ??= nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  return transport;
}

export async function graphToken(): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(process.env.MS_TENANT_ID!)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!,
      client_secret: process.env.MS_CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Microsoft sign-in failed (${res.status}). Check the MS_* settings in Vercel.`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Send one message. Returns the provider's message id (used to thread follow-ups). */
export async function deliver(msg: Outgoing): Promise<{ via: MailProvider; messageId: string | null }> {
  const provider = mailProvider();
  if (provider === "gmail") {
    const info = await gmail().sendMail({
      from: { name: msg.fromName, address: process.env.GMAIL_USER! },
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      ...(msg.inReplyTo ? { inReplyTo: msg.inReplyTo, references: msg.inReplyTo } : {}),
      ...(msg.headers ? { headers: msg.headers } : {}),
    });
    return { via: "gmail", messageId: info.messageId ?? null };
  }
  if (provider === "graph") {
    const token = await graphToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.MS_SENDER!)}/sendMail`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: msg.subject,
          body: { contentType: "Text", content: msg.text },
          toRecipients: [{ emailAddress: { address: msg.to } }],
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) throw new Error(`Microsoft 365 rejected the message (${res.status}).`);
    return { via: "graph", messageId: null };
  }
  throw new Error("No email account is connected. Open the email in your mail app, send it, then mark it sent.");
}

export function mailtoHref(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
