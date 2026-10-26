# Later phases with acceptance criteria

Phases follow the brief's order. Phases 1–2 are implemented in this repository (see the feature matrix); 3 is prepared and blocked on access; 4 is partially implemented; 5–6 are designed here.

## Phase 3: Website integration and staged deployment
- Website PR adds *Client Portal* to desktop and mobile navigation and `/client-portal` redirect, merged into existing config.
- Portal deployed to a Preview with its own database branch; then `portal.thehernandezsolutions.com` with DNS from the Vercel project.
- **Done when:** e2e suite passes against the Preview URL; website preview shows the link on both menus; production smoke test in deployment-vercel.md passes.

## Phase 4: Verified read-only Microsoft / Atera
- Entra sign-in validated with a real customer tenant and an MSP technician from the HS tenant.
- Intune inventory imported for one consenting customer; stale/failed states observed.
- Atera contract checklist passes; agent import verified for one customer.
- **Done when:** results recorded in testing.md under "live validation", with dates and tenants (no secrets).

## Phase 5: Controlled bidirectional Atera sync
- Per atera-sync-design.md. **Done when:** its acceptance tests pass with mocks, then a supervised pilot on one customer shows no duplicates and no private-note leakage.

## Phase 6

**Status (2026-10-19):** notifications, SLAs, attachments and email intake are implemented (see feature-matrix.md and email-setup.md). One-click unsubscribe shipped 2026-10-25. Not done: malware scanning of attachments, push notifications.

### Attachments
Private object storage (Vercel Blob private store, or Azure Blob with SAS issued per request); upload via short-lived signed URL scoped to one ticket; max size (e.g. 15 MB) and allow-list of types; MIME detected from content, not extension; malware scan (e.g. Microsoft Defender for Storage or ClamAV worker) with quarantine before availability; downloads via authorized endpoint with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`; retention follows the ticket; customer offboarding deletes blobs.
**Done when:** tests show cross-customer download denied, oversize/mismatched type rejected, quarantined file not downloadable, internal-note attachment invisible to customers.

### Notifications
In-app: unread markers per ticket from `ticket_events`. Email: provider (e.g. Microsoft Graph sendMail from a service mailbox, or Postmark/SendGrid) via the outbox; per-user preferences; one-click unsubscribe for non-essential mail; emails contain ticket number and a link, minimal content. Push (after native/PWA push is verified): generic text only.
**Done when:** preferences respected, outbox retries without duplicates, no internal-note text in any email.

### Email intake
Verified inbound webhook (provider signature + timestamp), replay protection (message-ID dedupe), size limits, safe MIME parsing, HTML converted to text, reply correlation via signed per-ticket reply token in the address or header; sender address alone never authorizes; unknown senders create a *needs review* item for technicians.
**Done when:** spoofed sender cannot reply to someone else's ticket; replayed webhook ignored.

### SLAs
Per-customer policy by priority with first-response and resolution targets; business hours, holidays and time zone per customer; pause while *waiting*, resume on customer reply; escalations via jobs; every breach/escalation audited; dashboards show attainment computed from these policies only.
**Done when:** unit tests cover business-hour math across DST and holidays, pause/resume, and breach events.
