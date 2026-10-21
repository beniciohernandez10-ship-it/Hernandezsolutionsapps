# Off-site audit log

The portal records sign-ins, permission changes, denied requests and administrative actions in `audit_events`. To protect that record, every event is also copied to a **separate PostgreSQL database** that the portal can only append to.

## What this protects against

| If someone gets… | They can… | They can't… |
| --- | --- | --- |
| The portal's credentials (Vercel env, a server bug) | Add audit events | Read, change or delete anything in the audit store (`audit_writer` has no table access, only three functions) |
| Owner access to the portal database | Change `audit_events` there (after dropping its guard trigger) | Change the off-site copy; the next check shows the two disagree |
| Owner access to the audit store | Drop the guard and edit or rebuild the chain | Do it unnoticed: the portal database keeps a checkpoint of the chain head, and the daily check compares them |

Covering all three needs both databases compromised at once. Keep the audit store's owner login in Neon only (not in Vercel, not in the repo).

## How it works

- **Main database** (migration 0015): `audit_events.exported_at` marks rows that reached the store. A trigger blocks deleting audit rows or changing their content.
- **Audit store** (`db/audit/0001_audit_store.sql`, its own database):
  - `audit_log` is append-only: a trigger refuses UPDATE, DELETE and TRUNCATE for everyone.
  - Each row stores `prev_hash` and `hash = SHA-256(prev_hash + row content)`.
  - `audit_append(source, events)` adds a batch and skips ids it already has, so a retried send never duplicates.
  - `audit_verify()` recomputes the whole chain.
  - `audit_hash_at(seq)` returns one stored hash for the checkpoint comparison.
  - The `audit_writer` login can call only these three functions.
- **Sending:** right after any change (and any denied request) and during each queued-work run, plus the daily cron. A failed send leaves the rows marked unsent in the main database, and they go out on the next attempt.
- **Checking:** the daily cron runs the chain check and compares it with the checkpoint. A failure is logged as `audit.verify_failed` and shown in red on **Administration → Audit log**. Operators can also press **Send and check now**.

## Setting it up (once)

1. **Create the database.** Sign in at console.neon.tech with an account that has two-step sign-in. Create a **new project** (not a branch of the portal's): name `hernandez-audit`, region AWS US East (N. Virginia) to match the portal, Postgres 17. The free plan is enough.
2. **Give the setup script the owner connection string.** In the project's dashboard, choose **Connect** and copy the connection string. In `hernandez-it-center/`, create a file named `.env.audit.local` (git ignores it) containing:
   ```
   AUDIT_OWNER_DATABASE_URL=postgresql://neondb_owner:...@...neon.tech/neondb?sslmode=require
   ```
3. **Run the setup.** From `hernandez-it-center/`:
   ```
   npm run audit:setup
   ```
   It creates the store's tables, gives `audit_writer` a random password, checks that this login can append but not read, and saves the writer's connection string in Vercel production as `AUDIT_DATABASE_URL`. No secret is printed.
4. **Redeploy** the portal, for example by pushing a commit or using Vercel → Deployments → Redeploy.
5. **Confirm.** Open **Administration → Audit log** and press **Send and check now**. All existing records are sent, and the page should say the chain is intact.
6. **Delete `.env.audit.local`.**

## Maintenance

- **Rotate the writer password:** put the owner string back in `.env.audit.local`, run `npm run audit:setup` again, redeploy, then delete the file. The script is safe to re-run; it only applies schema changes that are new.
- **Schema changes to the store:** add `db/audit/000N_*.sql` and run `npm run audit:setup`. The portal's deploy never touches the store's schema, because it doesn't have the owner credentials.
- **Retention:** nothing is deleted. Neon's free plan allows 0.5 GB; at a few hundred bytes per event that's well over a million events.
- **Investigating:** query `audit_log` in the Neon SQL editor as the owner. The `customer_id`, `actor_user_id` and `at` columns are indexed.
- **If a check fails:** treat it as a security incident. Don't modify either database. Export the Neon project (or use Neon's point-in-time restore to inspect the earlier state), review who has access to Neon and Vercel, and rotate the credentials.
