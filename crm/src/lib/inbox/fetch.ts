import { createHash } from "node:crypto";
import { simpleParser, type ParsedMail } from "mailparser";
import { graphToken, mailProvider } from "../mail";
import type { InboundMail } from "./classify";

/**
 * Reads recent mail from the sending mailbox. Read-only: nothing is marked
 * read, moved or deleted. Gmail uses IMAP with the same app password that
 * sends mail. Microsoft 365 also needs the Mail.Read application permission.
 */

const MAX_MESSAGES = 200;
const MAX_BYTES = 256 * 1024;

const headerText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "value" in v) {
    const o = v as { value: unknown; params?: Record<string, string> };
    return [o.value, ...Object.entries(o.params ?? {}).map(([k, p]) => `${k}=${p}`)].join("; ");
  }
  return String(v);
};

export function fromParsed(p: ParsedMail, fallbackDate = new Date()): InboundMail | null {
  const from = p.from?.value?.[0]?.address?.toLowerCase();
  if (!from) return null;
  const headers: Record<string, string> = {};
  for (const [k, v] of p.headers) headers[k.toLowerCase()] = headerText(v);
  // A bounce's details are usually in an attached delivery-status part.
  const reports = (p.attachments ?? [])
    .filter((a) => /^(message\/delivery-status|text\/rfc822-headers)$/i.test(a.contentType))
    .map((a) => a.content.toString("utf8"));
  const receivedAt = p.date ?? fallbackDate;
  const references = Array.isArray(p.references) ? p.references : p.references ? [p.references] : [];
  return {
    messageId: p.messageId ?? `no-id:${createHash("sha256").update(`${from}|${receivedAt.toISOString()}|${p.subject ?? ""}`).digest("hex")}`,
    from,
    subject: p.subject ?? "",
    text: [p.text ?? "", ...reports].join("\n"),
    inReplyTo: p.inReplyTo ?? null,
    references,
    headers,
    receivedAt,
  };
}

export const parseRaw = async (raw: Buffer | string) => fromParsed(await simpleParser(raw));

async function fromGmail(since: Date): Promise<InboundMail[]> {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: process.env.GMAIL_USER!, pass: process.env.GMAIL_APP_PASSWORD! },
    logger: false,
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });
  await client.connect().catch((err: { authenticationFailed?: boolean }) => {
    throw new Error(err?.authenticationFailed ? "Gmail refused the sign-in. Check GMAIL_USER and GMAIL_APP_PASSWORD." : "Couldn't reach Gmail to read the mailbox.");
  });
  const raws: Buffer[] = [];
  try {
    await client.mailboxOpen("INBOX", { readOnly: true });
    const found = await client.search({ since }, { uid: true });
    const uids = (found || []).slice(-MAX_MESSAGES);
    if (uids.length) {
      for await (const m of client.fetch(uids, { source: { maxLength: MAX_BYTES } }, { uid: true })) {
        if (m.source) raws.push(m.source);
      }
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  const out: InboundMail[] = [];
  for (const raw of raws) {
    const m = await parseRaw(raw);
    if (m) out.push(m);
  }
  return out;
}

interface GraphMessage {
  internetMessageId?: string;
  subject?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string } };
  body?: { content?: string };
  internetMessageHeaders?: { name: string; value: string }[];
}

export function fromGraph(g: GraphMessage): InboundMail | null {
  const from = g.from?.emailAddress?.address?.toLowerCase();
  if (!from || !g.internetMessageId) return null;
  const headers: Record<string, string> = {};
  for (const h of g.internetMessageHeaders ?? []) headers[h.name.toLowerCase()] = h.value;
  return {
    messageId: g.internetMessageId,
    from,
    subject: g.subject ?? "",
    text: g.body?.content ?? "",
    inReplyTo: headers["in-reply-to"]?.trim() ?? null,
    references: (headers.references ?? "").split(/\s+/).filter(Boolean),
    headers,
    receivedAt: g.receivedDateTime ? new Date(g.receivedDateTime) : new Date(),
  };
}

async function fromMicrosoft(since: Date): Promise<InboundMail[]> {
  const token = await graphToken();
  const url = new URL(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.MS_SENDER!)}/mailFolders/inbox/messages`);
  url.searchParams.set("$filter", `receivedDateTime ge ${since.toISOString()}`);
  url.searchParams.set("$select", "internetMessageId,subject,receivedDateTime,from,body,internetMessageHeaders");
  url.searchParams.set("$top", String(MAX_MESSAGES));
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, prefer: 'outlook.body-content-type="text"' } });
  if (res.status === 403) throw new Error("Microsoft 365 refused to read the mailbox. Grant the app the Mail.Read application permission.");
  if (!res.ok) throw new Error(`Microsoft 365 refused to list messages (${res.status}).`);
  const { value } = (await res.json()) as { value: GraphMessage[] };
  return value.flatMap((g) => fromGraph(g) ?? []);
}

export async function fetchRecentMail(since: Date): Promise<InboundMail[]> {
  const provider = mailProvider();
  if (provider === "gmail") return fromGmail(since);
  if (provider === "graph") return fromMicrosoft(since);
  return [];
}
