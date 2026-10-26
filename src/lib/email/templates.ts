import { STATUS_LABEL, type Status } from "../tickets/schemas";

/**
 * Notification emails carry the ticket number, its title, one line about what
 * happened and a link. They never include message text, internal notes or
 * attachments: the portal is where content is read, behind sign-in.
 */
export type NotificationKind =
  | "ticket_created"
  | "public_reply"
  | "internal_note"
  | "status_changed"
  | "assigned"
  | "sla_warning"
  | "sla_breached"
  | "attachment_added"
  | "approval_requested"
  | "approval_decided"
  | "change_approval_requested"
  | "change_decided"
  | "change_scheduled"
  | "change_finished"
  | "incident_update";

/** Marker above which an email reply is read; everything below is ignored. */
export const REPLY_MARKER = "##- Reply above this line to add it to your request -##";

const TARGET: Record<string, string> = { first_response: "first response", resolution: "resolution" };

export function describeNotification(kind: NotificationKind, actor: string | null, detail: string | null): string {
  const who = actor ?? "Someone";
  switch (kind) {
    case "ticket_created":
      return `${who} opened a new request.`;
    case "public_reply":
      return `${who} replied.`;
    case "internal_note":
      return `${who} added a private note.`;
    case "status_changed":
      if (detail === "resolved") return `${who} marked this request as resolved. Tell us how we did on the request page. It closes automatically after a few days; reply before then if it isn't fixed.`;
      if (detail === "waiting") return `${who} is waiting on more information from you.`;
      return `${who} changed the status to ${STATUS_LABEL[detail as Status] ?? detail}.`;
    case "assigned":
      return `${who} assigned this ticket to you.`;
    case "sla_warning":
      return `The ${TARGET[detail ?? ""] ?? "SLA"} target is coming up soon.`;
    case "sla_breached":
      return `The ${TARGET[detail ?? ""] ?? "SLA"} target was missed.`;
    case "attachment_added":
      return `${who} added a file.`;
    case "approval_requested":
      return `${who} submitted a request that needs your approval.`;
    case "approval_decided":
      return detail === "rejected" ? `${who} did not approve this request.` : `${who} approved this request.`;
    case "change_approval_requested":
      return `${who} submitted a planned change that needs your approval.`;
    case "change_decided":
      return detail === "rejected" ? `${who} did not approve this change.` : `${who} approved this change.`;
    case "change_scheduled":
      return "Planned maintenance is scheduled. Open it to see the window and what to expect.";
    case "incident_update":
      return detail === "resolved" ? "A wider issue affecting your organization is resolved." : "There's an update on a wider issue affecting your organization.";
    case "change_finished":
      return detail === "failed" ? "Planned maintenance didn't go as planned and was backed out." : "Planned maintenance is complete.";
  }
}

const SUBJECT_SUFFIX: Record<NotificationKind, string> = {
  ticket_created: "New request",
  public_reply: "New reply",
  internal_note: "Private note",
  status_changed: "Status update",
  assigned: "Assigned to you",
  sla_warning: "SLA due soon",
  sla_breached: "SLA missed",
  attachment_added: "New file",
  approval_requested: "Approval needed",
  approval_decided: "Approval decision",
  change_approval_requested: "Change approval needed",
  change_decided: "Change decision",
  change_scheduled: "Planned maintenance",
  change_finished: "Maintenance update",
  incident_update: "Service status",
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Header-safe single line. */
const oneLine = (s: string, max: number) => s.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);

export interface NotificationEmailInput {
  kind: NotificationKind;
  detail: string | null;
  actorName: string | null;
  ticketNumber: number;
  ticketTitle: string;
  /** "Request #12" (default) or "Change CHG-12". */
  refLabel?: string;
  customerName: string;
  ticketUrl: string;
  settingsUrl: string;
  /** One-click link that turns off this kind of email (no sign-in needed). */
  unsubscribeUrl: string;
  /** The setting it turns off, as named on the settings page. */
  unsubscribeLabel: string;
  /** True when replying to this email adds a public reply to the ticket. */
  replyEnabled: boolean;
}

export function renderNotificationEmail(i: NotificationEmailInput) {
  const title = oneLine(i.ticketTitle, 120);
  const ref = i.refLabel ?? `Request #${i.ticketNumber}`;
  const shortRef = i.refLabel ? i.refLabel.replace(/^Change /, "") : `#${i.ticketNumber}`;
  const subject = `[${shortRef}] ${title} · ${SUBJECT_SUFFIX[i.kind]}`;
  const line = describeNotification(i.kind, i.actorName ? oneLine(i.actorName, 80) : null, i.detail);
  const replyText = i.replyEnabled ? "You can reply to this email to add a message to your request." : "Open the request to respond.";
  const text = [
    ...(i.replyEnabled ? [REPLY_MARKER, ""] : []),
    `${ref}: ${title}`,
    i.customerName,
    "",
    line,
    "",
    `Open it: ${i.ticketUrl}`,
    replyText,
    "",
    "Hernandez Solutions IT Center",
    `Stop these emails ("${i.unsubscribeLabel}"): ${i.unsubscribeUrl}`,
    `Email settings: ${i.settingsUrl}`,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#111827">
${i.replyEnabled ? `<div style="color:#9ca3af;font-size:11px;padding:8px 16px">${escapeHtml(REPLY_MARKER)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px" cellpadding="0" cellspacing="0">
<tr><td style="padding:20px 24px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">Hernandez Solutions IT Center · ${escapeHtml(oneLine(i.customerName, 120))}</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 4px;font-size:13px;color:#6b7280">${escapeHtml(ref)}</p>
<h1 style="margin:0 0 16px;font-size:18px;line-height:1.35">${escapeHtml(title)}</h1>
<p style="margin:0 0 20px;font-size:15px">${escapeHtml(line)}</p>
<a href="${escapeHtml(i.ticketUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px">Open ${escapeHtml(ref.charAt(0).toLowerCase() + ref.slice(1))}</a>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280">${escapeHtml(replyText)}</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af">You get this because you're part of this request and &ldquo;${escapeHtml(i.unsubscribeLabel)}&rdquo; is on in your email settings.<br><a href="${escapeHtml(i.unsubscribeUrl)}" style="color:#6b7280">Unsubscribe from these emails</a> · <a href="${escapeHtml(i.settingsUrl)}" style="color:#6b7280">Email settings</a></td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
