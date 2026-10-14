# Atera ticket synchronization: design (phase 5, not implemented)

Bidirectional sync stays disabled (`atera.ticket_write` jobs fail with "not enabled") until the contract checklist in [atera-setup.md](atera-setup.md) passes and this design is confirmed against the real Atera behavior. This document defines the rules the implementation must follow.

## Direction and source of truth

| Field | Owner | Portal → Atera | Atera → Portal |
| --- | --- | --- | --- |
| Title, description (at creation) | Portal (customer-authored) | on create only | never overwrites |
| Status | Portal | mapped push | accepted only if the portal version has not changed since last sync; else *needs review* |
| Priority | Portal (technicians) | push | accepted under the same rule as status |
| Assignee/technician | Portal | push when the Atera technician mapping exists | ignored |
| Public comments | Origin system | portal public replies → Atera comment | Atera *public* comments → portal public messages |
| Private technician notes | Portal | **never sent through a public comment operation**; sent only if Atera exposes a verifiably internal-only note operation, otherwise not synced | Atera internal notes → portal internal notes only if the API marks them internal unambiguously |
| Attachments | n/a | not synced in phase 5 | not fetched; returned attachment URLs are never followed |
| Customer / contact | Portal mapping | must resolve to the mapped Atera customer and a contact belonging to it | records for other customers are rejected |

## Status mapping (to verify against Atera's actual values)

| Portal | Atera (expected) |
| --- | --- |
| Open | Open |
| In progress | Pending / In progress (confirm) |
| Waiting | Pending (confirm whether a "waiting for customer" state exists) |
| Resolved | Resolved / Closed (confirm whether Atera distinguishes) |

Unknown Atera statuses → *needs review*, no automatic mapping.

## Contact and customer validation

Before creating an Atera ticket: the portal requester must map to an Atera contact whose `CustomerID` equals the ticket customer's mapped Atera customer ID. If no contact exists, create none automatically in phase 5; mark *needs review* and let a technician link the contact.

## Writes: outbox, retries, ambiguity

- Every write is a `jobs` row inserted in the same transaction as the portal change (transactional outbox), with `dedupe_key = atera:{op}:{ticketId}:{portalVersion}`.
- Create ticket: before writing, search Atera for an existing ticket carrying the portal reference (e.g. `HS-{number}` in the title or a custom field, if Atera supports one) to make retries detectable. If the create call **times out or returns 5xx**, the outcome is ambiguous: the job moves to *needs review*; it is **not retried automatically** until a reconciliation search proves no ticket was created.
- Updates are idempotent by design (set status X) and may be retried with backoff; comments are not idempotent and follow the same ambiguity rule as creates.
- Delivery is at-least-once with deduplication, not exactly-once.

## Reads, reconciliation and conflicts

- Poll (or use webhooks if Atera supports verified signed webhooks on the plan) per mapped customer, using a high-water mark on modification time.
- Each imported record must carry the mapped customer ID; otherwise it is dropped and the run is marked *needs review*.
- Conflict = both sides changed the same owned field since the last sync → keep the portal value, record a `needs_review` link state, show it to technicians.
- Nightly reconciliation compares linked tickets' status and comment counts and flags drift.

## Rendering provider content

Atera comment bodies may contain HTML. Convert to plain text server-side (strip tags, decode entities) before storing; never render vendor HTML. Links are shown as text.

## Status shown to users

`provider_ticket_links.sync_status`: *pending*, *synchronized*, *failed*, *needs review*, with `last_synced_at` and a staff-only error.

## Acceptance tests to add with the implementation

Ambiguous create timeout → no retry, needs review; private note never sent to a public endpoint (assert on the mock); record for another customer rejected; conflict detection; duplicate job deduplicated; comment HTML rendered as text.
