# Time tracking and billing

## Logging time (technicians)

- **On a request:** the **Time** card on the request page. Pick 15m / 30m / 1h or type a duration (`45m`, `1h 30m`, `1.5h`, `1:30`), set the date, untick **Billable** for time you won't charge, and add a note. **Start timer** keeps running in that browser even if you reload; **Use** puts the elapsed time in the box.
- **General work for a client** (patch review, a site visit, admin work not tied to one request): **Timesheet** in the sidebar → **Log time**. Enter a request number to attach it to a request, or leave it blank.
- **Changing time:** your own entries can be edited or removed until the month is invoiced. Service managers can correct anyone's entries for their clients. Time can't be in the future or more than a year back.
- **Timesheet** shows your week (Monday to Sunday) with daily totals. Service managers can pick a technician to see their week (only for clients they manage).

## Plans (operators)

Administration → **Billing** → a client → **Plan**. Each client has one active plan:

| Plan | How it bills |
| --- | --- |
| Monthly retainer | A fixed monthly fee including a number of hours each month; extra time at the hourly rate |
| Block of hours | Prepaid hours that carry over from month to month from the start date; once used up, time is billed at the hourly rate |
| Hourly | Every billable minute at the hourly rate |

**Round each entry up to** (exact, 6, 10, 15, 30 or 60 minutes) applies to each billable entry before totalling, so a 7-minute call billed in 15-minute increments counts as 15. Non-billable time is shown but never charged.

Saving a plan replaces the current one (the old one stays on record). **End plan** stops charging until a new plan is set.

## Monthly billing

Administration → **Billing** lists every client for a month: billable time, included hours, overage, the amount, and whether the month is finalized. Open a client to see each entry and:

1. **Export CSV for invoicing:** one line per entry (date, request, technician, description, logged and billed minutes, hours) and a summary (plan fee, overage, total). Spreadsheet formulas in notes are neutralised.
2. **Finalize month:** after you've invoiced, once the month has ended. This records the amounts as invoiced and **locks** that month's time: nobody can add, edit or remove it, and later plan changes don't alter it.
3. **Reopen month:** if something needs correcting, then finalize again.

## What clients see

Client administrators see a **Support plan** line on their Reports page: time used this month against what's included (retainer), or hours left in their block. They never see notes, rates, amounts or who logged the time.

Every change (time logged, edited or removed, plans, finalize, reopen) is in the audit log (`time.*`, `billing.*`).
