"use client";

export interface ApiErrorBody {
  code: string;
  message: string;
  fields?: { path: string; message: string }[];
  [k: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

function csrfToken() {
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? "";
}

/** Same-origin JSON fetch with the session's CSRF token and consistent error handling. */
export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        "x-csrf-token": csrfToken(),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, { code: "network", message: "We couldn't reach the server. Check your connection and try again." });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const body: ApiErrorBody = data?.error ?? { code: "internal", message: "Something went wrong. Please try again." };
    if (res.status === 401 && body.code === "unauthenticated") {
      window.location.assign(`/signin?returnTo=${encodeURIComponent(location.pathname + location.search)}`);
    }
    if (res.status === 401 && body.code === "reauth_required") {
      window.location.assign(`/api/auth/signin?prompt=login&returnTo=${encodeURIComponent(location.pathname)}`);
    }
    throw new ApiError(res.status, body);
  }
  return data as T;
}

export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.body.fields) return {};
  return Object.fromEntries(err.body.fields.map((f) => [f.path, f.message]));
}

/** Same-origin multipart upload with the CSRF token; errors handled like apiFetch. */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "x-csrf-token": csrfToken() },
      body: form,
    });
  } catch {
    throw new ApiError(0, { code: "network", message: "We couldn't reach the server. Check your connection and try again." });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 413) throw new ApiError(413, { code: "too_large", message: "That file is too large." });
    throw new ApiError(res.status, data?.error ?? { code: "internal", message: "Something went wrong. Please try again." });
  }
  return data as T;
}
