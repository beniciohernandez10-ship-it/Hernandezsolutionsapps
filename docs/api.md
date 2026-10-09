# API reference

All endpoints are same-origin JSON under `https://portal.thehernandezsolutions.com/api`. The browser portal and installed PWA use them with the session cookie. Responses are `Cache-Control: no-store`.

**Errors** use one shape:

```json
{ "error": { "code": "validation_failed", "message": "Please check the highlighted fields.", "fields": [{ "path": "title", "message": "…" }] }, "requestId": "…" }
```

Codes: `unauthenticated` (401), `reauth_required` (401), `forbidden` (403), `csrf_failed` (403), `not_found` (404, also used for resources you may not see), `version_conflict` (409, includes `currentVersion`), `idempotency_conflict` (409), `reopen_window_closed` (409), `validation_failed` (422), `invalid_transition` (422), `rate_limited` (429, with `Retry-After`), `not_configured` (503), `internal` (500).

**Mutations** (POST/PATCH/DELETE) require `x-csrf-token: <token>` (from `GET /api/me` or the page's `csrf-token` meta tag) and a same-origin `Origin` header.

## Auth

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/auth/signin?returnTo=/portal/...&prompt=login&invite=...` | Redirects to Microsoft. Rate limited per IP. |
| GET | `/auth/callback` | Microsoft redirect target. Creates the session. |
| POST | `/auth/signout` | Revokes the session. Returns `{ redirect }`. |
| POST | `/auth/demo` | `{ personaId }`. Local demo only; 404 elsewhere. |
| GET | `/me` | Current user, memberships, capabilities, `csrfToken`, `sessionExpiresAt`. |
| GET | `/health` | `{ status, database }`. No auth. |

## Tickets

| Method | Path | Body / query | Who |
| --- | --- | --- | --- |
| GET | `/tickets` | `q`, `status` (`open`,`in_progress`,`waiting`,`resolved`,`active`), `priority`, `customerId`, `assigned` (`me`,`unassigned`), `mine`, `page`, `pageSize` (≤100) | any member; results scoped to the caller |
| POST | `/tickets` | header `Idempotency-Key` (8–128 chars `[A-Za-z0-9_-]`); `{ title, description, priority, category, customerId?, deviceId? }` | any member. Customer is required only if the caller has several. Requester is always the caller. 201 new, 200 replay |
| GET | `/tickets/{id}` | | visible tickets only; internal notes only for staff |
| PATCH | `/tickets/{id}` | `{ expectedVersion, status?, priority?, assigneeUserId?, queueId? }` | staff: all fields; customers: `status` resolve/reopen per policy |
| POST | `/tickets/{id}/messages` | `{ body, visibility: "public" \| "internal" }` | internal = staff only. A customer reply on a *waiting* ticket sets it to *open*; on a *resolved* ticket inside the reopen window it reopens it |
| POST | `/tickets/{id}/devices` | `{ deviceId }` | client admin / staff; device must belong to the ticket's customer |
| GET | `/tickets/{id}/assignees` | | staff: assignable technicians and queues |

Priorities: `low`, `normal`, `high`, `urgent`. Categories: `general`, `account_access`, `hardware`, `software`, `network`, `email`, `security`, `other`.

Reopen policy: customers may reopen within `REOPEN_WINDOW_DAYS` (default 14) of resolution; staff any time. Every reopen increments `reopenCount` and records a `reopened` event.

## Devices

| GET | `/devices?customerId=` | client admin / staff. Returns devices and per-provider `sync` status (`synchronized`, `pending`, `failed`, `needs_review`, `never`) with `lastSuccessAt`. |
| --- | --- | --- |

## Administration (platform operators; recent sign-in required for changes)

| Method | Path | Body |
| --- | --- | --- |
| GET | `/admin/customers` | |
| POST | `/admin/customers` | `{ name, slug }` |
| POST | `/admin/customers/{id}/directories` | `{ tenantId, displayName, inventoryEnabled }` |
| POST | `/admin/customers/{id}/atera` | `{ connectionId, ateraCustomerId }` (queues a read-only verification job) |
| GET/POST | `/admin/customers/{id}/memberships` | `{ email, displayName, role, tenantId }` → may return a one-time `invitation.url` |
| DELETE | `/admin/memberships/{membershipId}` | |
| PATCH | `/admin/customers/{id}/status` | `{ status: "active" \| "offboarding" \| "offboarded" }` |

## Jobs

| GET | `/cron/jobs` | `Authorization: Bearer $CRON_SECRET`. Schedules hourly syncs, processes the queue, purges expired auth state. |
| --- | --- | --- |
