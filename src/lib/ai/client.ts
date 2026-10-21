import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { AppError } from "../errors";
import { log, errorSummary } from "../log";

/**
 * The only place that talks to the Anthropic API. Every call asks for JSON
 * matching a schema (structured outputs); callers validate it again with Zod.
 * Refused requests are retried server-side on Anthropic's recommended
 * fallback model (fallbacks: "default").
 */

export interface AiCall {
  system: string;
  user: string;
  /** JSON schema of the reply (objects need additionalProperties: false). */
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
}

export interface AiResult {
  text: string;
  stopReason: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type AiTransport = (call: AiCall) => Promise<AiResult>;

let transport: AiTransport | undefined;
let client: Anthropic | undefined;

/** Tests replace the network call with a fake model. */
export function setAiTransportForTesting(t: AiTransport | undefined) {
  transport = t;
}

export async function callClaude(call: AiCall): Promise<AiResult> {
  if (transport) return transport(call);
  const { apiKey, model } = config().ai;
  if (!apiKey) throw new AppError(503, "not_configured", "The AI assistant isn't set up.");
  client ??= new Anthropic({ apiKey, timeout: 55_000, maxRetries: 1 });
  try {
    const res = await client.beta.messages.create({
      model,
      max_tokens: call.maxTokens ?? 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: call.system,
      messages: [{ role: "user", content: call.user }],
      output_config: { effort: call.effort, format: { type: "json_schema", schema: call.schema } },
    });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return { text, stopReason: res.stop_reason, model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  } catch (err) {
    log.warn("ai.call_failed", { error: errorSummary(err) });
    if (err instanceof Anthropic.RateLimitError) {
      throw new AppError(429, "rate_limited", "The AI assistant is busy. Please try again in a minute.", { retryAfter: 60 });
    }
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new AppError(503, "not_configured", "The AI assistant's API key was rejected. Check ANTHROPIC_API_KEY.");
    }
    throw new AppError(502, "ai_unavailable", "The AI assistant didn't respond. Please try again.");
  }
}
