/**
 * Outbound HTTP policy for provider calls (Microsoft Graph, Entra token
 * endpoints, Atera):
 * - credentials are only ever sent to an explicit allow-list of HTTPS hosts,
 *   checked before every request including pagination links;
 * - redirects are never followed;
 * - every request has a timeout;
 * - only idempotent reads are retried automatically, a bounded number of
 *   times, honouring Retry-After for throttling.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly opts: { status?: number; retryable: boolean; ambiguous?: boolean; retryAfterMs?: number },
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface HttpPolicy {
  allowedHosts: string[];
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryAfterMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function assertAllowedUrl(raw: string, allowedHosts: string[]) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ProviderError("Provider returned an invalid URL.", { retryable: false });
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port || !allowedHosts.includes(u.hostname.toLowerCase())) {
    throw new ProviderError(`Refusing to send credentials to unapproved destination ${u.protocol}//${u.hostname}.`, { retryable: false });
  }
  return u;
}

export function parseRetryAfter(v: string | null, now = Date.now()): number | undefined {
  if (!v) return undefined;
  if (/^\d+$/.test(v.trim())) return Number(v.trim()) * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - now) : undefined;
}

export async function providerFetch(url: string, init: RequestInit, policy: HttpPolicy): Promise<Response> {
  assertAllowedUrl(url, policy.allowedHosts);
  const method = (init.method ?? "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  const maxRetries = idempotent ? (policy.maxRetries ?? 3) : 0;
  const doFetch = policy.fetchImpl ?? fetch;
  const sleep = policy.sleep ?? defaultSleep;
  const cap = policy.maxRetryAfterMs ?? 60_000;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(policy.timeoutMs ?? 15_000) });
    } catch (err) {
      const timedOut = (err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError";
      if (attempt < maxRetries) {
        await sleep(Math.min(cap, 500 * 2 ** attempt));
        continue;
      }
      // A write that timed out may or may not have been applied by the provider.
      throw new ProviderError(timedOut ? "Provider request timed out." : "Provider request failed.", {
        retryable: idempotent,
        ambiguous: !idempotent,
      });
    }
    if (res.status >= 300 && res.status < 400) {
      throw new ProviderError(`Provider attempted a redirect (${res.status}); not followed.`, { status: res.status, retryable: false });
    }
    if (res.status === 429 || res.status === 503 || res.status === 504) {
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      if (attempt < maxRetries && (retryAfterMs === undefined || retryAfterMs <= cap)) {
        await sleep(retryAfterMs ?? Math.min(cap, 1000 * 2 ** attempt));
        continue;
      }
      throw new ProviderError(`Provider throttled the request (${res.status}).`, {
        status: res.status,
        retryable: true,
        retryAfterMs,
        ambiguous: !idempotent && res.status !== 429,
      });
    }
    if (res.status >= 500) {
      if (attempt < maxRetries) {
        await sleep(Math.min(cap, 1000 * 2 ** attempt));
        continue;
      }
      throw new ProviderError(`Provider error ${res.status}.`, { status: res.status, retryable: idempotent, ambiguous: !idempotent });
    }
    return res;
  }
}

export async function readJsonResponse<T>(res: Response, maxBytes = 20 * 1024 * 1024): Promise<T> {
  const text = await res.text();
  if (text.length > maxBytes) throw new ProviderError("Provider response too large.", { retryable: false });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError("Provider returned invalid JSON.", { status: res.status, retryable: false });
  }
}
