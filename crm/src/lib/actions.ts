import { ZodError } from "zod";
import { ActionError } from "./auth/session";
import { unstable_rethrow } from "next/navigation";

export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: unknown;
} | null;

/** Turn thrown validation/permission errors into a form-friendly result; rethrow redirects. */
export function handleActionError(err: unknown): ActionState {
  unstable_rethrow(err);
  if (err instanceof ActionError) return { ok: false, error: err.message };
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      fieldErrors[key] ??= issue.message;
    }
    const first = err.issues[0];
    return { ok: false, error: first ? `${first.path.join(".") || "Input"}: ${first.message}` : "Check the form.", fieldErrors };
  }
  console.error("[action]", err);
  return { ok: false, error: "Something went wrong. Try again." };
}

/** FormData → plain object of strings; empty strings become undefined. */
export function formObject(fd: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    out[k] = t === "" ? undefined : t;
  }
  return out;
}
