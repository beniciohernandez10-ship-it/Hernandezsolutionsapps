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
| | Assignment to technicians or queues, priority changes | Implemented | /portal/queues board with bulk assign and move; operators manage queues at /portal/admin/queues |
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
| Devices | Registry: automatic names (WRKSTN-001, LAPTOP-001, MON-001, PHONE-001, DOCK-001 …), primary user, location, history | Implemented | asset-tags.md; hardware received on a request is registered automatically |
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
| | One-click unsubscribe (RFC 8058 headers + link, no sign-in) | Implemented | Turns off that kind of email or all email; Undo; audited |
| SLAs | Per-customer policies, business hours, holidays, time zones (DST-safe) | Implemented | Operators manage at Administration → Service levels |
| | Pause while waiting/resolved, warnings, breaches, staff-only display, attainment | Implemented | Hidden from customers in app and RLS; sweep runs on portal use + daily cron |
| Attachments | Upload, download, content-based type checks, internal files | Implemented | Private Vercel Blob store required in production; 4 MB per upload |
| | Malware scanning | Implemented | Files held until scanned clean; quarantine deletes bytes; built-in checks always, Cloudmersive antivirus when CLOUDMERSIVE_API_KEY is set; email-setup.md §3 |
| Service catalog | Request types with custom forms, per-customer or global | Implemented | Administration → Service catalog; six starter templates |
| | Approval by named approvers per company (else client admins, else service managers), fulfilment checklist | Implemented | Administration → Approvers; approvers see only requests that go through approval |
| | Hardware orders: approve → order → receive (serial scan, each item registered as a tagged asset) → deliver | Implemented | hardware-requests.md; ordering/delivery queues under Administration → Queues; computers always tech set-up |
| Knowledge base | Articles for all clients, one client, or technicians; drafts | Implemented | 7 starter articles from the public Help Center |
| | Full-text search, suggestions while typing a request, helpful votes, views | Implemented | Rendered from a Markdown subset, never raw HTML |
| Lifecycle | Resolution details required; auto-close after CLOSE_AFTER_DAYS (5) | Implemented | Customers can't reopen closed tickets |
| Productivity | Saved replies with fill-ins (shared or per client) | Implemented | Reply box → Insert a saved reply; /portal/replies |
| | Merge duplicates, parent/child requests | Implemented | Same-customer only, enforced by composite keys |
| | Automatic assignment rules | Implemented | Administration → Assignment rules; applied by a DB function on create |
| Reports | Monthly service report per client: volume, response/resolution medians, categories, priorities, top requesters | Implemented | /portal/reports; print/PDF; client admins see their own without SLA or comments |
| | SLA attainment, survey comments, CSV export | Implemented | Technicians only; CSV formulas neutralised |
| Monthly client reports | Per client and month: every resolved request with how it was solved, who solved it, target met/missed; categories, urgency, technicians; still-open list | Implemented | Administration → Monthly reports; created automatically after each month ends and saved; print/PDF and CSV; operators only |
| Surveys | Requester rates a resolved request (👍/👎 + comment), changeable until closed | Implemented | RLS-enforced |
| Change management | Planned changes: type, risk, window, impact, implementation/backout plans, linked requests | Implemented | /portal/changes calendar; technicians create and run |
| | Approval: standard pre-approved, normal by client admin, emergency by service manager; scheduled/finished notices | Implemented | Editing an approved change sends it back for approval |
| Major incidents | Declare for some or all clients, linked requests, status updates posted to every linked request, resolve them together | Implemented | Service managers; client admins notified |
| Status page | Active and recent incidents, planned maintenance, portal-wide banner | Implemented | /portal/status; maintenance via a DB function exposing no plans |
| Problem management | Problems (investigating → known error → resolved), root cause, workaround, permanent fix, linked requests | Implemented | Technicians only (RLS) |
| | Repeat-issue detection; workaround drafted as a knowledge article | Implemented | /portal/problems |
| Assets / CMDB | Hardware details (manufacturer, model, serial, purchase, warranty), change history, warranties-ending list | Implemented | Devices page |
| | Microsoft 365 license inventory (purchased / assigned / unassigned per SKU) | Implemented (mocked) | Read-only Graph subscribedSkus; needs Organization.Read.All consent |
| Audit trail | Off-site append-only copy in a separate PostgreSQL database, SHA-256 hash chain, daily integrity check with checkpoint | Implemented (needs setup) | docs/audit-log.md; Administration → Audit log |
| AI assistant | Draft replies, triage summary with suggested category/priority/next steps (technicians) | Implemented (mocked in tests) | Claude Opus 5.5; off until ANTHROPIC_API_KEY is set and an operator turns it on per customer; see docs/ai-assistant.md |
| | Self-help answers on a new request, only from published help articles, with links | Implemented (mocked in tests) | Never sends private notes or technician-only articles |
| Email intake | Verified Resend webhook, reply-by-email via one-time reply addresses | Implemented | Off until inbound domain + webhook secret are set |
| | Review inbox for unmatched email, convert to ticket | Implemented | Service managers only |
