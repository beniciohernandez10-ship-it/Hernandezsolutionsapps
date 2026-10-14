# Feature matrix

**Implemented** = built and covered by automated tests in this repo (mocks/local only unless stated). **Partial** = some parts built. **Planned** = designed, not built. **Blocked** = needs access or information.

| Area | Feature | Status | Notes |
| --- | --- | --- | --- |
| Ticketing | Create (title, description, priority, category), server-derived customer/requester | Implemented | |
| | Idempotent creation | Implemented | `Idempotency-Key` |
| | List, search, filters, pagination | Implemented | |
| | Detail, conversation, public replies | Implemented | |
| | Private technician notes | Implemented | App + RLS enforced |
| | Status lifecycle open / in progress / waiting / resolved | Implemented | |
| | Reopen policy | Implemented | Customers within 14 days, staff any time |
| | Assignment to technicians or queues, priority changes | Implemented | Queue management UI planned |
| | Ticket–device links | Implemented | |
| | Timestamps (created, updated, first response, resolution) | Implemented | |
| | Optimistic concurrency | Implemented | |
| | Audit history | Implemented | Ticket + admin + auth + denials |
| | Dashboard metrics from real, scoped data | Implemented | No SLA labels |
| Identity | Entra sign-in (code + PKCE, state, nonce, full token validation) | Implemented (mocked) | Not validated with a live tenant |
| | `(tid, oid)` mapping, invitations bound to directory | Implemented | |
| | Server-side sessions, idle/absolute expiry, revocation, logout | Implemented | |
| | CSRF + origin checks | Implemented | |
| | Re-authentication for operator changes | Implemented | |
| | MFA / Conditional Access | Relies on Entra | Enforced by customer tenants |
| Roles | Requester, client admin, technician, service manager, platform operator | Implemented | Manager-only features (SLA/reports) planned |
| Isolation | App-level checks + PostgreSQL RLS + composite keys + triggers | Implemented | |
| Persistence | Hosted PostgreSQL support, migrations, seed | Implemented | Not yet run against a hosted instance |
| | Durable sessions, rate limits, idempotency, job queue in Postgres | Implemented | |
| Integrations | Intune managed-device inventory (read-only) | Implemented (mocked) | Needs app registration + customer consent |
| | Sync status, stale detection, snapshot preservation | Implemented | |
| Devices | Registry: automatic names (WRKSTN-001, LAPTOP-001), primary user, location, history | Implemented | asset-tags.md |
| | Primary user from the customer's Microsoft directory | Implemented (mocked) | Needs `User.Read.All` + customer consent |
| | QR labels for Brother PT-D610BT (24 mm), print and PNG | Implemented | Print size verified as PDF; not tested on a physical printer |
| | Renaming the PC through Intune | Not built | Needs a privileged write permission; off by design |
| | Atera customer verification + agent import (read-only) | Partial | Contract **unverified**; see atera-setup.md |
| | Atera ticket import / bidirectional sync | Planned | Design in atera-sync-design.md; writes hard-disabled |
| | Azure subscription management | Not planned in scope | IDs stored for reference only |
| Clients | Responsive browser portal | Implemented | Desktop + phone tested |
| | Installable PWA | Implemented | Not yet tested on physical devices |
| | Native desktop / mobile apps | Planned | apps.md |
| Website | Client Portal nav link + `/client-portal` redirect | Blocked | Website repo/Vercel project not accessible; snippets ready |
| | Return links portal → website | Implemented | |
| Deployment | Vercel project, domain `portal.thehernandezsolutions.com` | Blocked | Needs Vercel team/project confirmation; nothing deployed |
| Branding | Semantic tokens, brand override file | Implemented | |
| | Hernandez Solutions colors, fonts, logo | Blocked | Only `#05060a` confirmed; awaiting brand values |
| | Page transitions and motion (reduced-motion aware) | Implemented | |
| Security | CSP with nonce, security headers, host allow-list, rate limiting, redacted logs | Implemented | |
| Phase 6 | Attachments, notifications, email intake, SLAs | Planned | roadmap.md |
