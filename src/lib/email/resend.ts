import { config } from "../config";
import { ProviderError, providerFetch, readJsonResponse, type HttpPolicy } from "../integrations/http";

/**
 * Resend REST client: sending, and reading received emails for intake.
 * Credentials only go to api.resend.com; attachment downloads go to the
 * signed URLs Resend returns, without credentials.
 */
const API = "https://api.resend.com";
const policy = (): HttpPolicy => ({ allowedHosts: ["api.resend.com"], timeoutMs: 15_000, fetchImpl: testFetch ?? undefined });

let testFetch: typeof fetch | null = null;
/** Test hook: route provider calls to a fake. */
export function setResendFetchForTesting(f: typeof fetch | null) {
  testFetch = f;
}

function apiKey() {
  const k = config().email.resendApiKey;
  if (!k) throw new ProviderError("Email is not configured.", { retryable: false });
  return k;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /** Makes retries safe: Resend sends at most once per key within 24 hours. */
  idempotencyKey: string;
}

export async function sendEmail(m: OutgoingEmail): Promise<{ id: string }> {
  const from = config().email.from;
  if (!from) throw new ProviderError("EMAIL_FROM is not configured.", { retryable: false });
  let res: Response;
  try {
    res = await providerFetch(
      `${API}/emails`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey()}`,
          "content-type": "application/json",
          "idempotency-key": m.idempotencyKey,
        },
        body: JSON.stringify({
          from,
          to: [m.to],
          subject: m.subject,
          text: m.text,
          html: m.html,
          ...(m.replyTo ? { reply_to: m.replyTo } : {}),
          ...(m.headers ? { headers: m.headers } : {}),
        }),
      },
      policy(),
    );
  } catch (err) {
    // With an idempotency key a retry cannot send twice, so an unclear outcome is safe to retry.
    if (err instanceof ProviderError && err.opts.ambiguous) {
      throw new ProviderError(err.message, { ...err.opts, ambiguous: false, retryable: true });
    }
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderError(`Resend rejected the email (${res.status}): ${body.slice(0, 200)}`, {
      status: res.status,
      retryable: res.status === 429 || res.status >= 500,
    });
  }
  return readJsonResponse<{ id: string }>(res);
}

export interface ReceivedEmail {
  id: string;
  from: string;
  to: string[];
  cc?: string[] | null;
  received_for?: string[] | null;
  subject: string | null;
  text: string | null;
  html: string | null;
  message_id?: string | null;
  headers?: Record<string, string> | null;
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
  attachments?: { id: string; filename: string; content_type: string; size: number }[];
}

export async function getReceivedEmail(id: string): Promise<ReceivedEmail> {
  if (!/^[A-Za-z0-9-]{1,100}$/.test(id)) throw new ProviderError("Invalid email id.", { retryable: false });
  const res = await providerFetch(`${API}/emails/receiving/${id}?html_format=cid`, { headers: { authorization: `Bearer ${apiKey()}` } }, policy());
  if (res.status === 404) throw new ProviderError("Received email not found.", { status: 404, retryable: false });
  if (!res.ok) throw new ProviderError(`Resend error ${res.status}.`, { status: res.status, retryable: res.status >= 500 || res.status === 429 });
  return readJsonResponse<ReceivedEmail>(res);
}

export interface ReceivedAttachment {
  id: string;
  filename: string;
  size: number;
  content_type: string;
  download_url: string;
}

export async function listReceivedAttachments(id: string): Promise<ReceivedAttachment[]> {
  if (!/^[A-Za-z0-9-]{1,100}$/.test(id)) throw new ProviderError("Invalid email id.", { retryable: false });
  const res = await providerFetch(`${API}/emails/receiving/${id}/attachments`, { headers: { authorization: `Bearer ${apiKey()}` } }, policy());
  if (!res.ok) throw new ProviderError(`Resend error ${res.status}.`, { status: res.status, retryable: res.status >= 500 || res.status === 429 });
  return (await readJsonResponse<{ data: ReceivedAttachment[] }>(res)).data ?? [];
}

/** Downloads one attachment from its signed URL (no credentials sent), refusing anything over maxBytes. */
export async function downloadAttachment(url: string, maxBytes: number): Promise<Uint8Array> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ProviderError("Invalid attachment URL.", { retryable: false });
  }
  if (u.protocol !== "https:") throw new ProviderError("Attachment URL must be HTTPS.", { retryable: false });
  const res = await (testFetch ?? fetch)(u, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!res.ok || !res.body) throw new ProviderError(`Attachment download failed (${res.status}).`, { status: res.status, retryable: res.status >= 500 });
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new ProviderError("Attachment is too large.", { retryable: false });
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ProviderError("Attachment is too large.", { retryable: false });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}
