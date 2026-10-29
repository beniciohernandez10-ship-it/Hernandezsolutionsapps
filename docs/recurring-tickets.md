# Recurring requests

Maintenance that happens on a schedule (monthly patch review, quarterly access review, yearly license renewal) opens a request by itself on each date. Find them under **Service management → Recurring**.

- **Who:** technicians see the schedules for their clients. Platform operators and the client's service managers create, change, pause and delete them.
- **Schedule:** daily, weekly, monthly, quarterly or yearly, every 1–12 of those, from a start date, optionally until an end date. Dates are counted from the start, so a schedule that starts on the 31st falls on the last day of shorter months. Dates are Pacific time.
- **The request:** a service request with the title, description, priority and category you set, from the **IT Center Scheduler** account or a named member of the client (if they've since left, the Scheduler account is used). It can go straight to a technician and/or a queue; otherwise assignment rules decide. The checklist becomes the request's tasks. Service levels and notifications apply as usual.
- **Placeholders:** title, description and checklist can use `{date}` (2026-11-15), `{month}` (November 2026), `{quarter}` (Q4 2026) and `{year}`.
- **Skip if still open** (on by default): a date is skipped while the previous request from the schedule is unresolved, so they don't pile up.
- **Missed dates:** if nothing ran for a while (the portal checks at most hourly while in use, and on the daily cron), one request is opened and the schedule moves to its next date after today. Missed dates aren't opened one by one.
- **Open one now** opens a request immediately without moving the schedule (to try a template, or when it's needed early).

Every change, request opened and date skipped is in the audit log (`recurring.*`).
