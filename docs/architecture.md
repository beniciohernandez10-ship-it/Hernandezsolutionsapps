# Architecture

## Starting point

The repository contained only a `.gitignore` when this work began. The earlier Node 24 / SQLite foundation described in the brief (roles, customer-scoped tickets, audit events, Entra adapter, `/portal` entry point, tests) was **not present** in `Hernandezsolutionsapps`, so nothing was replaced or migrated. If that source exists elsewhere, it should be reviewed against this implementation; see *Migrating from the SQLite foundation* below.

## Chosen architecture

| Concern | Choice | Why |
| --- | --- | --- |
| Web app + API | Next.js 16 (App Router) + TypeScript, one deployable | Native fit for Vercel; one backend for browser, PWA and native shells |
| Production data | Hosted PostgreSQL 13+ (Neon via Vercel Marketplace, or Azure Database for PostgreSQL) | Relational data, row-level security, durable across deployments |
| Local / test data | PGlite (PostgreSQL compiled to WebAssembly) | Same SQL, same RLS policies, no server to install. Never used when deployed (`openDatabase` refuses without `DATABASE_URL` on Vercel) |
| Sessions, auth state, rate limits, idempotency | PostgreSQL tables | Shared by every serverless instance and survives restarts; no in-memory state |
| Background work | `jobs` table (transactional outbox) processed by Vercel Cron → `/api/cron/jobs` | Durable, `FOR UPDATE SKIP LOCKED` claiming, no extra service required. Swap for a managed queue later if volume demands |
| Identity | Microsoft Entra ID, authorization code + PKCE, confidential client | Server-side secret; `(tid, oid)` identity mapping |
| Secrets | Vercel environment variables (or Azure Key Vault referenced from them) | Never in the repo, never in browser bundles |
| Logs | Structured JSON to stdout with key-based redaction (`src/lib/log.ts`) | Vercel log drains can forward to any SIEM |
| Attachments | Not implemented; planned for private object storage (see roadmap) | |

## Request flow

1. `src/proxy.ts` runs first: host allow-list, per-request CSP nonce, security headers, `no-store` for portal and API.
2. Pages (server components) call `requirePrincipal()`, which reads the session cookie, looks up the session row (idle + absolute expiry, revocation), and reloads the user's memberships from the database on **every request**.
3. API routes are wrapped by `api()` (`src/lib/http/api.ts`): the same session/principal load, plus Origin + CSRF token checks on mutations, per-user rate limits, optional recent-sign-in requirement, error mapping and denial auditing.
4. Service functions (`src/lib/tickets/service.ts`, `src/lib/admin/service.ts`) authorize explicitly, then run SQL in a transaction that switches to the restricted `itc_app` role with `app.user_id` set, so PostgreSQL row-level security applies as a second, independent layer.

## Data model

Identifiers are deliberately separate:

- `customers.id`: the internal customer. Nothing external is used as a key.
- `entra_directories.tenant_id`: Microsoft Entra directory ID, mapped through `customer_entra_directories` (a directory belongs to at most one customer). The MSP home directory has `kind = 'msp'`.
- `customer_azure_subscriptions.subscription_id`: recorded only; no Azure resource management is implemented or implied.
- `atera_connections` (one per Atera account/API key, storing only the env-var *name*) and `customer_atera_mappings.atera_customer_id`.
- `user_identities (tenant_id, object_id)`: the only way a Microsoft sign-in maps to a user. Email is contact data only.
- `devices.intune_managed_device_id` and `devices.entra_device_id` are separate columns; `atera_agent_id` is a third.

Core tables: `users`, `memberships` (role per customer, revocable), `invitations`, `tickets`, `ticket_messages` (`public` / `internal`), `ticket_events`, `ticket_devices`, `queues`, `audit_events`, `sessions`, `auth_requests`, `idempotency_keys`, `rate_limits`, `jobs`, `sync_states`, `provider_ticket_links`.

### Tenant safeguards in the database

- Composite foreign keys `(ticket_id, customer_id)` and `(device_id, customer_id)` make it impossible to attach a message, event or device to a ticket of another customer.
- Trigger `tickets_guard`: a ticket's customer and requester never change; the requester must be a member of the customer; the assignee must be technician/service manager **for that customer**.
- Row-level security (`FORCE ROW LEVEL SECURITY`) on every tenant table for the `itc_app` role, using `SECURITY DEFINER` helper functions over `memberships`. Internal notes are invisible to non-staff at the database level.
- `itc_app` has no access at all to sessions, auth requests, invitations, rate limits or provider credentials tables.

## Migrations

`db/migrations/NNNN_*.sql`, applied in order by `npm run db:migrate` (or `scripts/migrate.ts` in a deploy step), each in its own transaction, tracked in `schema_migrations`. Migrations never run during request handling. Customer and membership provisioning happens only through operator workflows or explicit scripts, never during serverless initialization.

### Migrating from the SQLite foundation (if it is found)

1. Export customers, users, memberships, tickets, messages and audit events from SQLite to CSV/JSON.
2. Create `entra_directories` + `customer_entra_directories` rows from whatever tenant IDs the old system stored, and `user_identities` only for users whose `(tid, oid)` pair is known. Users known only by email must be re-invited (the new model never trusts email).
3. Insert tickets with their original timestamps as the system role; the `tickets_guard` trigger will reject rows whose requester is not a member of the ticket's customer, which surfaces bad data instead of importing it.
4. Map old roles: technician → `technician` membership per explicitly assigned customer (not global), client administrator → `client_admin`, requester → `requester`.
5. Re-run the isolation test suite against the migrated database.
