# Security model and operations runbook

This describes what the code does today. It is not a claim of regulatory compliance, production readiness, or an independent security review; none has been performed.

## Authentication

- Microsoft Entra ID, OAuth 2.0 authorization code flow with **PKCE (S256)**, `state` and `nonce`, confidential web client (`src/lib/auth/entra.ts`).
- `state` is stored server-side (hash only), bound to the initiating browser by a short-lived HttpOnly cookie, single-use, and expires after 10 minutes.
- ID token checks: RS256 signature against Microsoft's JWKS, audience = client ID, `exp`/`iat` with 2-minute skew, maximum age 1 hour, issuer must equal `https://login.microsoftonline.com/{tid}/v2.0` for the token's own `tid`, `ver` 2.0, `nonce` match (constant-time), and `tid` must be an operator-approved directory.
- **A valid token is not authorization.** The `(tid, oid)` pair must map to a provisioned, active user with an active membership (or operator flag). Email, UPN, customer name, URL parameters and directory membership never grant access.
- New people join through **invitations**: a one-time code that is only accepted from the directory the operator specified, binding the first `(tid, oid)` that presents it.
- MFA and Conditional Access are enforced by each customer's Entra tenant during sign-in; the portal does not weaken or bypass them.
- The client secret is read only on the server. No secret is ever shipped to a browser, PWA, desktop or mobile bundle.

## Sessions

- Opaque 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie. In production (HTTPS origin) the cookie is `__Host-itc_session`: `Secure`, `Path=/`, no `Domain`, so it is scoped to `portal.thehernandezsolutions.com` and never sent to the public website.
- Only the SHA-256 hash of the token is stored. Idle timeout (default 120 min) and absolute lifetime (default 12 h).
- Logout revokes the session row, clears the cookie, sends `Clear-Site-Data: "cache", "storage"`, and redirects through Entra's logout endpoint.
- Membership revocation and customer offboarding take effect on the next request (principals are reloaded every request); revoking a person's last membership also revokes their sessions.
- Operator changes require a sign-in within the last 15 minutes (`REAUTH_MINUTES`); otherwise the API returns `reauth_required` and the UI sends the user through `prompt=login`.

## Authorization

- Enforced on the server in two independent layers: explicit checks in service functions and PostgreSQL row-level security for the restricted `itc_app` role. Hidden buttons are cosmetic.
- Not-visible resources return 404, so the existence of other customers' tickets is not revealed.
- Denied API calls are written to `audit_events` (`action = 'api.access', outcome = 'denied'`) and logged as `authz.denied`.

| Capability | Requester | Client admin | Technician | Service manager | Platform operator |
| --- | --- | --- | --- | --- | --- |
| Create requests | own org | own org | assigned customers | assigned customers | only with a membership |
| See tickets | own only | whole org | assigned customers | assigned customers | none without a membership |
| Public replies | own tickets | org tickets | yes | yes | no |
| Private notes | no | no | yes | yes | no |
| Status changes | resolve own / reopen within 14 days | same, org-wide | any | any | no |
| Assign / priority | no | no | yes | yes | no |
| Device inventory | no | own org | assigned customers | assigned customers | no |
| Device registry: view, labels | no | own org | assigned customers | assigned customers | no |
| Device registry: register, edit, retire | no | no | assigned customers | assigned customers | no |
| Customer onboarding, mappings, memberships | no | no | no | no | yes |

Service-manager-only features (SLA policies, reports, queue management) are not built yet; the role is modeled and currently has technician capabilities within its assigned customers.

## Request security

- CSRF: every mutating API request needs the session's CSRF token in `x-csrf-token` **and** an `Origin` equal to `APP_ORIGIN`; `Sec-Fetch-Site: cross-site` is rejected.
- Input validation with Zod; length limits; control characters rejected; LIKE wildcards escaped; all SQL parameterized.
- XSS: ticket and provider text is rendered as React text (escaped). No `dangerouslySetInnerHTML` anywhere. CSP with per-request nonce and `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`.
- Headers: HSTS (HTTPS), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `no-store` and `noindex` on portal/API responses.
- Host handling: set `ALLOWED_HOSTS` in production; other Host headers receive 421. Redirect targets after sign-in must be same-site relative paths.
- Rate limits (PostgreSQL-backed, shared across instances): sign-in start and callback per IP, ticket creation, replies and updates per user.
- Idempotency: ticket creation requires an `Idempotency-Key`; replays return the original ticket, a different body with the same key is rejected.

## Provider calls

- Outbound requests only to an allow-list of HTTPS hosts, checked before each request including pagination links; redirects are never followed; timeouts on every call.
- Only idempotent reads are retried, at most 3 times, honoring `Retry-After` (capped at 60 s).
- A non-idempotent call that times out or fails with 5xx is treated as **ambiguous**: the job moves to `needs_review` and is never retried automatically.
- Imports replace the stored snapshot only after every page succeeded. Atera imports fail closed if any record lacks the mapped customer ID.
- Provider error text is shown only to staff.
- AI assistant (Anthropic API): off per customer until an operator turns it on; only public conversation and client-visible help articles are sent, and only when a person presses an assistant button. Output is advisory and rendered as text. Usage is logged without content. See `docs/ai-assistant.md`.

## Secrets

- Stored in Vercel → Project → Settings → Environment Variables (per environment). Optionally reference Azure Key Vault from there. Never paste secrets into chat, tickets, or the repo.
- Database stores only the **name** of each Atera API-key variable.
- `ANTHROPIC_API_KEY` (AI assistant) is set only in Vercel; set a spend limit on the key in the Anthropic Console.
- Rotation: create the new Entra client secret / Atera key, set it in Vercel for each environment, redeploy, confirm sign-in and a sync run, then delete the old secret. Rotate at least yearly and immediately on suspected exposure. Rotating `CRON_SECRET` only requires updating the variable.

## Least privilege

- Database: use a migration/owner role for `npm run db:migrate`, and a runtime login role that is a member of `itc_app`. The app switches to `itc_app` for user-scoped work. Do not use a superuser at runtime (superusers bypass RLS).
- Graph: application permission `DeviceManagementManagedDevices.Read.All` only, in a separate app registration from sign-in.
- Atera: if Atera offers scoped or read-only keys for your plan, use one for imports.

## Operations runbook

**Environments.** Keep Development (local PGlite), Preview/Staging (own database branch, own Entra redirect URI, `DEMO_MODE` unset) and Production separate. Never point a Preview deployment at the production database.

**Health.** `GET /api/health` returns database reachability only. Monitor it externally (e.g. every minute) and alert on non-200.

**Logs and alerts.** Forward Vercel logs to your log platform. Alert on: spikes of `authz.denied` or `auth.token_rejected`; `job.failed`; any `sync_states.status` in `failed`/`needs_review` older than 24 h (`select * from sync_states where status in ('failed','needs_review')`); `jobs` in `dead` or `needs_review`.

**Backups.** Use the database provider's point-in-time recovery (Neon and Azure Database for PostgreSQL both provide it); additionally take a nightly `pg_dump --format=custom` to separate storage with 30-day retention. **Restore drill** (quarterly): restore into a new database/branch, run `npm run db:migrate` (no-op if current) and `npm test` against it with `DATABASE_URL` set, then spot-check a customer's ticket count.

**Retention.** Suggested defaults, to confirm with each customer contract: tickets 7 years after resolution, audit events 2 years, sessions/auth requests/rate limits purged automatically (`purgeExpiredAuthState`), idempotency keys 7 days.

**Customer offboarding.** 1) Administration → mark customer *offboarding* (people keep access; background syncs stop because they only run for active customers). 2) Export the customer's data: `select * from tickets where customer_id = $1` plus messages/events. 3) Mark *offboarded*: all members lose access immediately, Intune inventory is disabled. 4) After the agreed retention period, delete the customer row (cascades devices, mappings, memberships; tickets are `on delete restrict` and must be deleted explicitly first, which is intentional). 5) Ask the customer to remove admin consent for the inventory app in their tenant.

**Incident: suspected account compromise.** Revoke the user's memberships (sessions end automatically) or set `users.status = 'disabled'`; review `audit_events` for the user; rotate any secret they could reach.

**Dependencies.** `npm audit` in CI; enable Dependabot or Renovate for weekly updates; Next.js security releases are applied promptly. At the time of writing `npm audit` reports 0 vulnerabilities.

**Demo safety.** Demo personas require `DEMO_MODE=true`, are refused when `VERCEL_ENV=production`, and only work when `APP_ORIGIN` is `localhost`/`127.0.0.1`. Seed data refuses to load in production.
