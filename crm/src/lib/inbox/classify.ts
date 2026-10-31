/** Pure rules for what an incoming email is. Nothing here touches the database or the mailbox. */

export interface InboundMail {
  messageId: string;
  from: string;
  subject: string;
  /** Plain text, including any delivery-status report attached to a bounce. */
  text: string;
  inReplyTo: string | null;
  references: string[];
  /** Lower-cased header names. */
  headers: Record<string, string>;
  receivedAt: Date;
}

export type MailKind = "bounce" | "auto_reply" | "opt_out" | "reply";

const BOUNCE_SENDER = /^(mailer-daemon|mail-daemon|postmaster|mail\.delivery\.subsystem)@/i;

export function isBounce(m: Pick<InboundMail, "from" | "headers">): boolean {
  return BOUNCE_SENDER.test(m.from) || /multipart\/report.*delivery-status/is.test(m.headers["content-type"] ?? "");
}

/**
 * Who bounced, and whether it's permanent. Only a bad address counts as hard
 * (5.1.x, or wording that says so). A spam block (5.7.x), a full mailbox or
 * anything unclear is soft, because the address may be fine.
 */
export function bounceInfo(m: Pick<InboundMail, "text" | "headers">): { recipient: string | null; hard: boolean; status: string | null } {
  const header = m.headers["x-failed-recipients"]?.split(",")[0]?.trim();
  const reported = /(?:final|original)-recipient:\s*rfc822;\s*<?([^\s<>;]+@[^\s<>;]+)>?/i.exec(m.text)?.[1];
  const recipient = (header || reported || "").toLowerCase() || null;
  const status = /^\s*status:\s*([245]\.\d{1,3}\.\d{1,3})/im.exec(m.text)?.[1] ?? null;
  const badAddress = /address not found|user unknown|no such user|does(?:n't| not) exist|mailbox not found|recipient not found|unknown recipient|invalid recipient/i.test(m.text);
  const hard = status ? status.startsWith("5.1.") || (status.startsWith("5.") && !status.startsWith("5.7.") && badAddress) : badAddress;
  return { recipient, hard, status };
}

export function isAutoReply(m: Pick<InboundMail, "subject" | "headers">): boolean {
  const auto = m.headers["auto-submitted"]?.trim().toLowerCase();
  if (auto && auto !== "no") return true;
  if (m.headers["x-autoreply"] || m.headers["x-autorespond"] || m.headers["x-auto-response-suppress"]) return true;
  if (/^(auto_reply|auto-reply)$/i.test(m.headers.precedence?.trim() ?? "")) return true;
  return /^\s*(automatic reply|auto(?:matic)?[- ]?reply|out of (?:the )?office|away from (?:the )?office|on vacation)\b/i.test(m.subject);
}

/** The new text of a reply: everything above the quoted message and signature. */
export function replyText(text: string): string {
  const out: string[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const t = line.trim();
    if (t.startsWith(">")) break;
    if (/^on .{5,200} wrote:$/i.test(t)) break;
    if (/^-{2,}\s*(original|forwarded) message\s*-{2,}$/i.test(t)) break;
    if (/^_{5,}$/.test(t)) break;
    if (/^from:\s.+/i.test(t) && out.length) break;
    if (/^sent from my /i.test(t)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

/**
 * A reply asking not to be emailed. It looks only at a short first line, and
 * leans toward honoring it: wrongly stopping is cheap, wrongly continuing isn't.
 */
export function isOptOutReply(text: string): boolean {
  const first = replyText(text).split("\n").find((l) => l.trim())?.trim() ?? "";
  if (!first || first.length > 80) return false;
  if (/^no thanks?,? (needed|necessary)/i.test(first)) return false;
  return (
    /^(no thanks?|no,? thank you|not interested|unsubscribe|remove me|please remove|take me off|please take me off|do not (?:e-?mail|contact)|don'?t (?:e-?mail|contact))\b/i.test(first) ||
    /^stop(?: (?:e-?mailing|contacting|sending)\b.*)?[.!]*$/i.test(first)
  );
}

export function classifyMail(m: InboundMail): MailKind {
  if (isBounce(m)) return "bounce";
  if (isAutoReply(m)) return "auto_reply";
  return isOptOutReply(m.text) ? "opt_out" : "reply";
}
