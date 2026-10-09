import { api } from "@/lib/http/api";
import { capabilities } from "@/lib/authz";

export const dynamic = "force-dynamic";

/** Current user, memberships and CSRF token for same-origin clients (portal, installed PWA). */
export const GET = api(async ({ principal, session }) => ({
  user: { id: principal.userId, displayName: principal.displayName, email: principal.email },
  memberships: principal.memberships,
  capabilities: capabilities(principal),
  csrfToken: session.csrfToken,
  sessionExpiresAt: session.expiresAt.toISOString(),
}));
