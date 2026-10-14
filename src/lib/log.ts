/**
 * Structured JSON logging with redaction. Never log tokens, cookies, codes,
 * secrets or message bodies; callers pass identifiers, not content.
 */
const SENSITIVE = /(token|secret|password|authorization|cookie|code_verifier|^code$|api[-_]?key|nonce|state|body|description)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") {
    // Bearer tokens / JWT-looking strings never belong in logs.
    if (/^Bearer\s/i.test(value) || /^eyJ[\w-]+\.[\w-]+\./.test(value)) return "[redacted]";
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  return value;
}

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (process.env.ITC_LOG_SILENT === "true") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as object) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (e: string, f?: Record<string, unknown>) => emit("debug", e, f),
  info: (e: string, f?: Record<string, unknown>) => emit("info", e, f),
  warn: (e: string, f?: Record<string, unknown>) => emit("warn", e, f),
  error: (e: string, f?: Record<string, unknown>) => emit("error", e, f),
};

export function errorSummary(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message.slice(0, 300) };
  return { message: String(err).slice(0, 300) };
}
