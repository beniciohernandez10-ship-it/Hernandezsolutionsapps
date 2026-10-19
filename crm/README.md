# Lead Command Center

The sales CRM for Hernandez Solutions LLC: prospects, an 18-stage pipeline, a daily call center,
email outreach with approval, follow-ups, analytics and client onboarding.

It lives in the `crm/` folder of this repository and deploys as its **own** Vercel project. It is
separate from the client portal (repository root) and from the public website (deployed from the
laptop, never Git-linked).

## What it does

- **Prospects**: one list for every business, with separate views for startups and veterinary
  practices. Filters, saved views, bulk actions, CSV/Excel export.
- **Pipeline**: 18 stages, drag and drop. Deal values are estimates (managed users × $65/user/month
  by default) and are never counted as revenue. Revenue comes only from active clients.
- **Call center**: a daily queue toward your call goal (10 by default), click-to-call, scripts,
  one-tap outcomes, follow-up scheduling and tomorrow's queue.
- **Outreach**: industry templates, sequences that draft follow-ups on a schedule, and an approval
  queue. **No email is ever sent without a person clicking send.** Sequences only create drafts that
  wait for approval. Every email carries your signature, mailing address and an opt-out line.
- **Follow-ups**: tasks with a private calendar feed (ICS) you can subscribe to in Outlook or Google.
- **Import**: CSV or Excel, column mapping, a dry-run preview, duplicate review and an import report.
  Missing values stay blank; nothing is invented.
- **Scoring**: each point shows its evidence and whether it is data, your judgment, or an estimate.
- **AI research** (optional): findings must cite a page the search actually returned, and nothing is
  saved until you accept it.
- **Clients**: convert a won deal, track contracted monthly revenue and an onboarding checklist.
  Passwords and keys are never stored here (the form blocks them).
- **Security**: two-step sign-in, roles (Owner, Admin, Sales, Viewer), audit log, rate limits,
  backups and an allow-list of host names.

## Local development

Requires Node 20+ and PostgreSQL.

```bash
cd crm
npm install
cp .env.example .env.local      # fill in DATABASE_URL, APP_ENCRYPTION_KEY, SETUP_TOKEN, CRON_SECRET
npx prisma migrate deploy
npm run db:seed                 # built-in templates and the standard 4-email sequence
npm run dev
```

Open http://localhost:3000/setup, enter your `SETUP_TOKEN`, and create the owner account. You will
be asked to turn on two-step sign-in with an authenticator app.

Useful commands:

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript check |
| `npm run import:file -- leads.csv --dry-run` | Preview an import from the command line |
| `npm run import:file -- leads.csv --tag "October list"` | Import and tag every row |
| `npm run jobs:run` | Run the daily jobs once (sequences, tomorrow's queue, cleanup) |
| `npm run user:create` | Add a user from the command line |

## Deploying to Vercel

1. In Vercel, **Add New → Project**, pick this repository, and set **Root Directory** to `crm`.
   Keep it a separate project from the portal and the website.
2. Create a new Neon database (Vercel **Storage → Neon**, or neon.tech) and connect it to this project
   so `DATABASE_URL` is set.
3. In **Settings → Environment Variables**, add the values from `.env.example`:
   `APP_ENCRYPTION_KEY`, `SETUP_TOKEN`, `CRON_SECRET`, `APP_ORIGIN` (for example
   `https://crm.thehernandezsolutions.com`), `ALLOWED_HOSTS` (the same host name), and
   `GMAIL_USER` / `GMAIL_APP_PASSWORD` when you're ready to send. Don't paste these into chat.
4. Add the domain under **Settings → Domains** (for example `crm.thehernandezsolutions.com`).
5. Deploy. Production builds run database migrations and load the built-in templates automatically
   (`scripts/deploy-migrate.ts`), so no manual database step is needed.
6. Visit `/setup` on the live address to create the owner account, then turn on two-step sign-in.

The daily job runs at 13:00 UTC (6 AM Pacific) from `vercel.json`; the Hobby plan allows one cron a
day, which is all this needs.

## Sending email from Gmail

Until a domain mailbox exists, email goes out from `thehernandezsolutionsllc@gmail.com`.

1. Turn on 2-Step Verification for that Google account.
2. Go to https://myaccount.google.com/apppasswords and create an app password named "Lead Command Center".
3. In Vercel, set `GMAIL_USER` to the address and `GMAIL_APP_PASSWORD` to the 16-character password, then redeploy.
4. In the app, open **Settings → Outreach** and enter your **business mailing address**. Sending is
   blocked until it is set (CAN-SPAM requires a postal address in sales email).

Keep the daily sending limit low (20–40) for a new sender. When you move to a domain mailbox on
Microsoft 365, set the four `MS_*` variables and the app switches over.

## Loading the current lead list

Use **Import** in the app, or from your machine with `DATABASE_URL` pointing at production:

```bash
npm run import:file -- Hernandez_Solutions_Master_Leads_Recovered.csv --dry-run
npm run import:file -- Hernandez_Solutions_Master_Leads_Recovered.csv
```

The import report lists every row as created, merged, flagged for review or skipped, with the reason.

## Backups

**Settings → Backup** downloads a JSON backup (owners only). It excludes passwords, two-step
secrets and session data. Restore only adds records that don't already exist; it never overwrites.
