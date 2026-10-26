# Email, file storage and SLA setup

The IT Center's notifications, file attachments and email intake work without any of this: notifications show in the portal (the bell), files are refused with "not set up yet" in production, and the email inbox stays empty. Each part below switches one piece on. Paste secret values straight into Vercel; never into chat, tickets, or files in this repository.

## 1. Sending notification email (Resend)

1. In Resend (the account on `thehernandezsolutionsllc@gmail.com`), **Domains → Add domain** → `thehernandezsolutions.com`.
2. Resend shows DNS records (DKIM `TXT`, SPF `MX` + `TXT` on a `send` subdomain). The domain's DNS is hosted by Vercel: add them in Vercel → **Domains → thehernandezsolutions.com → DNS Records**, or give the record values (not secret) to whoever manages the project.
3. When Resend shows the domain as **Verified**, create an API key with **Sending access** for that domain.
4. In Vercel → `hernandez-solutions-portal` → Settings → Environment Variables (Production):
   - `RESEND_API_KEY` = the key (mark Sensitive)
   - `EMAIL_FROM` = `Hernandez Solutions IT Center <support@thehernandezsolutions.com>`
5. Redeploy. Notification emails now go out within seconds of each change.

What an email contains: the request number, title, customer name, one line about what happened, and a link. Never message text, private notes or files. Each person controls their own email in **Email settings** (`/portal/settings`). Demo users (`@example.com`) are never emailed.

Unsubscribing: every notification email has an **Unsubscribe from these emails** link and `List-Unsubscribe` / `List-Unsubscribe-Post` headers (RFC 8058), so Gmail, Outlook and Apple Mail show their own Unsubscribe button. Either one turns off just that kind of email (for example "New requests") without signing in; the page also offers "Stop all IT Center email" and Undo. Links last a year, are stored only as hashes and can change nothing but that person's email settings. Each change is audited (`notifications.unsubscribe` / `notifications.resubscribe`).

## 2. Receiving email (reply by email + intake)

Use a **subdomain**, so a future Microsoft 365 mailbox on the main domain is unaffected. Suggested: `in.thehernandezsolutions.com`.

1. Resend → **Domains → Add domain** → `in.thehernandezsolutions.com`, turn **Enable receiving** on (sending can be off). Add the DKIM record and the receiving `MX` record Resend shows (in Vercel DNS, as above). Wait for "verified".
2. Resend → **Webhooks → Add webhook**: URL `https://portal.thehernandezsolutions.com/api/inbound/resend`, event **email.received**. Copy its **signing secret** (`whsec_…`).
3. Vercel environment variables (Production):
   - `INBOUND_EMAIL_DOMAIN` = `in.thehernandezsolutions.com`
   - `RESEND_WEBHOOK_SECRET` = the signing secret (mark Sensitive)
   - The `RESEND_API_KEY` from step 1 must also be allowed to read received emails (a **Full access** key, or a second key used only for this).
4. Redeploy.

How replies are matched: each notification email that accepts replies has a one-time reply address `t-<random>@in.thehernandezsolutions.com`. A reply is added to the ticket **only if** it arrives at a live address, comes from the same person the email was sent to, and doesn't fail the sender's domain authentication (DMARC). It's then added with that person's normal permissions. Private-note and SLA emails never accept replies.

Everything else (new emails to any other address at the subdomain, replies from a different address, failed checks) waits in **Email inbox** (`/portal/inbox`) for a service manager, who can turn it into a request for a chosen person or discard it. Automatic replies (out of office, bounces) are discarded.

To advertise a support address: point clients at e.g. `help@in.thehernandezsolutions.com`, or when a Microsoft 365 mailbox exists, forward `support@thehernandezsolutions.com` to it.

## 3. File attachments (Vercel Blob, private)

From the repository root on a machine signed in to the Vercel CLI:

```bash
npx vercel link --project hernandez-solutions-portal --yes
npx vercel blob create-store hernandez-it-center-files --access private --environment production --environment preview
```

This connects a **private** store to the project (`BLOB_STORE_ID`); the app authenticates with the deployment's own token. Redeploy. Files are then readable only through the portal's download route, after sign-in and the same permission checks as the ticket.

Rules: up to 4 MB per file through the portal (Vercel's request limit), 10 MB for email attachments, 10 files per email. Allowed: PNG, JPEG, GIF, WebP, HEIC, PDF, DOCX, XLSX, PPTX, TXT, LOG, CSV, MD. The type is checked from the file's contents. HTML, SVG, scripts, executables, archives and Office files with macros are refused. Files are **not virus-scanned** yet (Vercel Blob has no scanner); the portal says so next to the upload button.

Hobby plan: 1 GB of storage and 10 GB transfer a month are included; when exceeded, Blob stops until the month resets (no charge).

## 4. Service levels

Administration → **Service levels**. A suggested policy (Mon–Fri 08:00–17:00 Pacific) exists but is not applied to anyone. Review its targets, then assign a policy per customer. Targets are business time; the resolution clock pauses while a ticket is *Waiting* or *Resolved*. Only staff see targets and breaches. Warnings go to the assignee and service managers at the policy's warning percentage, and again if a target is missed.

Timing: the Hobby plan's cron runs once a day, so SLA checks also run whenever anyone uses the portal (at most once a minute). For checks every few minutes regardless of traffic, move to Vercel Pro and change the cron in `vercel.json` to `*/5 * * * *`.
