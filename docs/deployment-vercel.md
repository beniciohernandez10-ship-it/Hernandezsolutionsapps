# Vercel deployment and custom domain

Nothing has been deployed yet. This repository and the public website are separate Vercel projects, so the portal can be deployed and rolled back without touching thehernandezsolutions.com.

## Before deploying, confirm

- Vercel **team/account** that owns thehernandezsolutions.com.
- The **website's project** name and repository (needed for the nav link; see [website-integration.md](website-integration.md)).
- Who manages **DNS** for thehernandezsolutions.com (Vercel DNS or an external registrar).

## 1. Create the portal project

Vercel → Add New → Project → import `beniciohernandez10-ship-it/Hernandezsolutionsapps`. Framework preset: Next.js. Root directory: repository root. Node.js version: 24.x (Settings → General).

## 2. Database

Vercel → Storage (Marketplace) → **Neon** (Postgres) → create, and connect it to the portal project for Production and Preview. Use a separate Neon branch for Preview. Alternatively use Azure Database for PostgreSQL Flexible Server and paste its connection string as `DATABASE_URL`.

Run migrations before the first deploy and on every release that adds a migration (from CI or a trusted machine):

```bash
DATABASE_URL="<production connection string>" npm run db:migrate
```

Do **not** run `npm run db:seed` against production (it refuses when `ITC_ENV=production`).

## 3. Environment variables

Vercel → Project → Settings → Environment Variables. Set per environment (Production, Preview). See `.env.example` for every variable.

| Variable | Production value |
| --- | --- |
| `APP_ORIGIN` | `https://portal.thehernandezsolutions.com` |
| `WEBSITE_URL` | `https://thehernandezsolutions.com` |
| `ALLOWED_HOSTS` | `portal.thehernandezsolutions.com` |
| `ITC_ENV` | `production` |
| `DATABASE_URL` | from Neon/Azure (secret) |
| `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | sign-in registration (secret) |
| `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` | inventory registration (secret) |
| `ATERA_API_KEY` | Atera key (secret), when enabled |
| `CRON_SECRET` | long random string (secret) |

Leave `DEMO_MODE` unset everywhere except local development.

## 4. Cron

`vercel.json` schedules `/api/cron/jobs` once a day (06:00 UTC), because Vercel Hobby rejects deployments whose crons run more than daily. Vercel sends `Authorization: Bearer $CRON_SECRET`. On Pro, change the schedule to `0 * * * *` for hourly inventory and queue processing.

## 5. Custom domain

1. Portal project → Settings → Domains → add `portal.thehernandezsolutions.com`.
2. Vercel shows the exact DNS record to create. **Use the record Vercel displays for this project**; do not copy values from documentation, because targets differ per project and change over time.
   - If thehernandezsolutions.com already uses Vercel DNS, Vercel can add it automatically.
   - Otherwise add the shown record (normally a `CNAME` for `portal`) at your DNS provider.
3. Wait for verification and certificate issuance, then add the Entra redirect URI `https://portal.thehernandezsolutions.com/api/auth/callback` if not already present.

## 6. Smoke test after deploy

- `https://portal.thehernandezsolutions.com/api/health` → `{"status":"ok","database":"ok"}`
- Sign in with an operator account; check a technician and a customer account.
- Response headers include `content-security-policy`, `strict-transport-security`, and a `__Host-itc_session` cookie.
- `/signin` shows no demo personas.

## Staging

Use Preview deployments (or a `staging.portal…` domain on a staging branch) with their own database branch and their own Entra redirect URI. Never share the production database with previews.
