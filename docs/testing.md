# Testing and verification results

Run on 2026-10-09 in the build container (Linux, Node 22.22, Chromium via Playwright 1.56).

| Suite | Command | Result |
| --- | --- | --- |
| Type check | `npm run typecheck` | pass |
| Unit + integration | `npm test` | **95 passed** (4 files) |
| Browser (desktop 1366×860 + Pixel 7) | `npm run test:e2e` | **14 passed** (7 scenarios × 2 viewports) |
| Production build | `npm run build` | pass |
| Dependency audit | `npm audit` | 0 vulnerabilities |

## What each check used

**Real PostgreSQL semantics, in-memory (PGlite):** every isolation, RLS, trigger, ticket, session, job-queue and admin test. These run the actual migrations, row-level security policies and grants. PGlite is single-connection, so "concurrent" tests (duplicate submissions, concurrent edits, job claiming) exercise the SQL logic (idempotency keys, version checks, `SKIP LOCKED`) but not true parallel connections; repeat them against hosted Postgres before production.

**Mocks:** Microsoft token endpoint and JWKS (locally generated RSA keys), Microsoft Graph responses, Atera responses, network timeouts and throttling. No live Microsoft or Atera account was contacted.

**Local HTTP + browser:** Playwright drives a production build (`next build && next start`) with a fresh local database and demo personas: sign-in redirect, ticket creation with validation errors, XSS payload rendered as text, replies, cross-customer URL denial, private-note confidentiality between technician and client admin, navigation and website return links on desktop and phone, no horizontal scroll, sign-out and post-logout 401, CSP/security headers.

**Live validation:** none yet. Entra sign-in, Graph inventory and Atera have not been exercised against real tenants/accounts.

## Coverage map to the brief

| Requirement | Where |
| --- | --- |
| Cross-customer read/write denial | `tests/integration/isolation.test.ts` "cross-customer isolation", e2e "cannot open another customer's ticket" |
| Requester-to-requester isolation | isolation "requester isolation" |
| Client administrator restrictions | isolation "client administrator restrictions" |
| Private-note confidentiality (app + RLS) | isolation "private-note confidentiality", e2e private notes |
| Revoked memberships, offboarding | isolation "revoked memberships" |
| Expired/idle/revoked sessions, disabled users | `auth.test.ts` "sessions" |
| Invalid/replayed auth state, browser binding | `auth.test.ts` "authorization code flow" |
| Invalid issuer, audience, tenant, signature, nonce, alg=none, expired | `auth.test.ts` "ID token validation" |
| CSRF, origin, cross-site fetch, unsafe input | `auth.test.ts` "API guards", `tickets.test.ts` validation + markup, e2e XSS |
| Duplicate submissions, concurrent edits | `tickets.test.ts` |
| Provider pagination, nextLink validation, ownership | `providers.test.ts` Graph + Atera |
| Throttling, Retry-After, bounded retries, redirects refused | `providers.test.ts` "HTTP policy" |
| Failed import preserves previous snapshot | `providers.test.ts` "imports a snapshot, then preserves it…" |
| Ambiguous provider writes | `providers.test.ts` "durable jobs" |
| Data persistence across deployments | Not automatable here; production uses hosted Postgres. Locally, PGlite data in `.data/` survives restarts (verified manually by restarting the server). |
| Desktop and narrow-screen workflows, website navigation, logout/return | `tests/e2e/portal.spec.ts` |
