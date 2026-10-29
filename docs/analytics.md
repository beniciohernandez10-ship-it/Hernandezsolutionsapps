# Analytics and report emails

## Analytics (Service management → Analytics)

For technicians and service managers, across the clients they support (or one client), over the last 30, 90, 180 days or 12 months. Trends are weekly up to 90 days and monthly beyond, in Pacific time.

- **Summary:** opened, resolved, open right now (and how many are unassigned), median first response, median time to resolve, first-contact resolution, satisfaction.
- **Volume trend:** requests opened and resolved per week or month.
- **Service-level trend:** share of first-response targets met (by when the request was opened; an unanswered request counts once its target has passed) and resolution targets met (by when it was resolved). Gaps are periods with nothing measured.
- **Backlog age:** open requests by age (under 1 day, 1–3 days, 3–7 days, 1–4 weeks, over 4 weeks), by priority, and the five oldest.
- **Technician workload:** open assigned right now, resolved in the period, median time to resolve, and time logged on the timesheet.
- **First-contact resolution:** resolved requests that were never reopened and had at most one public reply from a technician before being resolved.

Every chart has a table view. Figures are read with the viewer's own access, so a technician only ever sees their clients.

## Month-end report emails

When the daily cron generates last month's report for a client (Administration → Monthly reports), the client's administrators can get a summary by email: opened, resolved, still open, median time to resolve, resolved within target and satisfaction, with a link to the full report in the portal (behind sign-in; no ticket details in the email).

- **Off per client** until an operator ticks *Send automatically when each month's report is ready* on any of that client's saved reports.
- **Email this report now** sends the saved report straight away (for example after a rebuild).
- Each person can turn off *Monthly reports* in Settings or with the one-click unsubscribe link in the email.
- Needs email sending set up (`docs/email-setup.md`). Each email sent is in the audit log (`report.emailed`).
