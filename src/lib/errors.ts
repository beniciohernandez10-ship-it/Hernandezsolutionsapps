export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthenticated"
  | "reauth_required"
  | "forbidden"
  | "csrf_failed"
  | "not_found"
  | "version_conflict"
  | "idempotency_conflict"
  | "reopen_window_closed"
  | "invalid_transition"
  | "rate_limited"
  | "not_configured"
  | "internal";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found.`);
export const forbidden = (msg = "You do not have permission to do that.") => new AppError(403, "forbidden", msg);
export const unauthenticated = () => new AppError(401, "unauthenticated", "Sign in to continue.");
