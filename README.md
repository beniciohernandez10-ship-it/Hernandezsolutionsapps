# Hernandez Solutions IT Center

A multi-tenant IT support portal for Hernandez Solutions and its customers. Customers submit and follow support requests; technicians work them; every organization's data stays isolated. One backend serves the browser portal, the installable web app (PWA), and future native shells.

> **Status: increment 1–2 foundation.** Ticketing, customer isolation, Microsoft Entra sign-in, PostgreSQL persistence and read-only Intune/Atera adapters are implemented and tested locally. Nothing has been validated against live Microsoft or Atera accounts or deployed yet. See [the feature matrix](docs/feature-matrix.md) for exactly what is implemented, partial, or planned.

## Quick start (local)

Requirements: Node.js 22+ (24 recommended, see `.nvmrc`). No database server is needed locally: the app uses an embedded PostgreSQL (PGlite) under `.data/`.

```bash
npm install
cp .env.example .env.local      # local defaults, no secrets
npm run setup                   # apply migrations + load fictional demo data
npm run dev                     # http://localhost:3000
```

Open http://localhost:3000, pick a **demo persona** (fictional people, local only), and try the portal as a requester, client administrator, technician, service manager or platform operator.

Stop the dev server before running `npm run setup` again: PGlite allows one process per data directory.

To use a real PostgreSQL locally, set `DATABASE_URL` (and `DATABASE_SSL=false` for a local server without TLS) and run `npm run db:migrate`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` | TypeScript checks |
| `npm test` | Unit + integration tests (Vitest, in-memory PostgreSQL) |
| `npm run test:e2e` | Browser tests (Playwright, desktop + phone viewports) |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:seed` | Load fictional demo data (refuses in production) |
| `npm run jobs:run` | Run one pass of the background job queue |

## Repository layout

```
db/migrations/          SQL schema, row-level security, grants
scripts/                migrate, seed, run-jobs CLIs
src/proxy.ts            CSP nonce, security headers, host allow-list
src/app/                Next.js App Router: pages (portal UI) and /api routes
src/lib/db/             PostgreSQL access (pg in production, PGlite locally), migrator, demo seed
src/lib/auth/           Entra OIDC (PKCE/state/nonce), sessions, CSRF helpers, demo guard
src/lib/authz.ts        Roles and principal loading
src/lib/tickets/        Ticket service + validation schemas
src/lib/admin/          Operator workflows: onboarding, mappings, memberships
src/lib/integrations/   Graph (Intune) and Atera read-only adapters, outbound HTTP policy
src/lib/jobs.ts         Durable job queue / transactional outbox
src/styles/             Semantic theme tokens + brand override file
public/                 PWA icon and service worker
website-integration/    Snippets for thehernandezsolutions.com (not applied)
tests/                  Vitest (unit/integration) and Playwright (e2e)
docs/                   Specification, setup guides, runbook
```

## Documentation

- [Architecture and data model](docs/architecture.md)
- [Security model and operations runbook](docs/security.md)
- [API reference](docs/api.md)
- [Customer onboarding and roles](docs/roles-and-onboarding.md)
- [Microsoft Entra / Graph registration and consent](docs/microsoft-setup.md)
- [Atera configuration and contract verification](docs/atera-setup.md) · [Bidirectional sync design](docs/atera-sync-design.md)
- [Vercel deployment and custom domain](docs/deployment-vercel.md)
- [Website navigation integration](docs/website-integration.md)
- [Desktop and mobile delivery](docs/apps.md)
- [Branding and theme tokens](docs/branding.md)
- [Later phases: attachments, notifications, email, SLAs](docs/roadmap.md)
- [Testing and verification results](docs/testing.md)
- [Feature matrix](docs/feature-matrix.md)
