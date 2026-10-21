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
| Website | Client Portal nav link + `/client-portal` redirect | Implemented | Live on thehernandezsolutions.com |
| | Return links portal → website | Implemented | |
| Deployment | Vercel project, domain `portal.thehernandezsolutions.com` | Implemented | Auto-deploys from main; Neon attached |
| Branding | Semantic tokens, brand override file | Implemented | |
| | Hernandez Solutions colors, fonts, logo | Blocked | Only `#05060a` confirmed; awaiting brand values |
| | Page transitions and motion (reduced-motion aware) | Implemented | |
| Security | CSP with nonce, security headers, host allow-list, rate limiting, redacted logs | Implemented | |
| Notifications | In-app notifications (bell, list, per-ticket read) | Implemented | Fan-out via the job queue; never notifies the actor |
| | Email notifications (Resend), per-user preferences | Implemented | Off until RESEND_API_KEY + EMAIL_FROM are set; no message text in email; email-setup.md |
| SLAs | Per-customer policies, business hours, holidays, time zones (DST-safe) | Implemented | Operators manage at Administration → Service levels |
| | Pause while waiting/resolved, warnings, breaches, staff-only display, attainment | Implemented | Hidden from customers in app and RLS; sweep runs on portal use + daily cron |
| Attachments | Upload, download, content-based type checks, internal files | Implemented | Private Vercel Blob store required in production; 4 MB per upload |
| | Malware scanning | Not built | No scanner on Vercel Blob; files labelled "not virus-scanned" |
| Service catalog | Request types with custom forms, per-customer or global | Implemented | Administration → Service catalog; six starter templates |
| | Approval by the client admin (service manager if none), fulfilment checklist | Implemented | Checklist built from the template by a DB function; staff-only edits |
| Knowledge base | Articles for all clients, one client, or technicians; drafts | Implemented | 7 starter articles from the public Help Center |
| | Full-text search, suggestions while typing a request, helpful votes, views | Implemented | Rendered from a Markdown subset, never raw HTML |
| Lifecycle | Resolution details required; auto-close after CLOSE_AFTER_DAYS (5) | Implemented | Customers can't reopen closed tickets |
| Productivity | Saved replies with fill-ins (shared or per client) | Implemented | Reply box → Insert a saved reply; /portal/replies |
| | Merge duplicates, parent/child requests | Implemented | Same-customer only, enforced by composite keys |
| | Automatic assignment rules | Implemented | Administration → Assignment rules; applied by a DB function on create |
| Email intake | Verified Resend webhook, reply-by-email via one-time reply addresses | Implemented | Off until inbound domain + webhook secret are set |
| | Review inbox for unmatched email, convert to ticket | Implemented | Service managers only |
