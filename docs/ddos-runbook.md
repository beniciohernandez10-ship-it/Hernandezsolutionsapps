# DDoS and abuse runbook

For thehernandezsolutions.com (website), portal.thehernandezsolutions.com (IT Center) and crm.thehernandezsolutions.com (CRM). All three run on Vercel, and the domain and its DNS are with Vercel.

Commands below use the Vercel CLI from any folder on this computer that's linked to a project (for example the website folder), signed in as `thehernandezsolutionsllc-7428`. Check with `npx vercel whoami`.

| Project | `--project` name |
| --- | --- |
| Website | `hernandez-solutions` |
| Portal (IT Center) | `hernandez-solutions-portal` |
| CRM | `hernandez-crm` |

## What's in place (set 2026-10-27)

**Every site, automatically (all plans):** Vercel absorbs network floods (layers 3, 4 and 7) before they reach the sites. Blocked traffic isn't billed. Nothing to configure.

**Firewall rules.** The Hobby plan allows 3 custom rules per project (one of them a rate limit); one slot is kept free for incidents:

| | Website | Portal | CRM |
| --- | --- | --- | --- |
| Rate limit (per IP, 429 when exceeded) | `/api/*`: 20/min | Everything except static files and `/api/inbound/*`: 600/min (10/s) | Everything except static files: 300/min (5/s) |
| Deny scanner probes (403) | yes | yes | yes |
| AI crawler bots | Deny | Deny | Deny |
| Bot Protection | Log | Log | Log |
| Free slot for incidents | 1 | 1 | 1 |

The scanner-probe rule denies paths like `/wp-admin`, `/wp-login.php`, `/xmlrpc.php`, `/phpmyadmin`, `/cgi-bin`, `/.env`, `/.git`, `/.aws`, `/.ssh` and anything ending in `.php`. None of them exist on these sites.

The exact live configuration is exported in [`docs/firewall/`](firewall/) (one JSON file per project). Re-export after any change: `npx vercel firewall rules list --project <name> --json > docs/firewall/<name>.json`.

**In the apps:** the website forms have their own per-IP limit, the portal and CRM limit sign-in attempts, and the portal limits each signed-in user's API calls.

### Machine traffic that must never be challenged

Bot Protection stays on **Log**, not Challenge, because these callers can't solve a browser challenge, and the Hobby plan has no bypass rules to exempt them:

- Vercel Cron: `/api/cron/newsletter` (website), `/api/cron/jobs` (portal), `/api/cron/daily` (CRM). Vercel lets its own cron through Attack Mode automatically.
- Resend's inbound email webhook: `/api/inbound/resend` (portal).
- One-click unsubscribe POSTs from Gmail, Outlook and Apple Mail: `/api/newsletter/unsubscribe/*` (website) and `/api/unsubscribe/*` (portal).
- Calendar apps polling the CRM's calendar feed: `/api/calendar/*` (CRM).

## Signs of an attack

- A site is slow, or shows 429 or 503 errors for normal visitors.
- A flood of "new lead" or newsletter-signup emails, or Resend reporting unusual sending.
- Neon showing a compute spike, or the portal being slow while Vercel looks healthy.
- Firewall alerts, including DDoS mitigation episodes: `npx vercel firewall alerts --project <name>`, or Vercel → the project → Firewall.

## During an incident

**1. Look (2 minutes).** See what's hitting which site:

```bash
npx vercel firewall overview --project hernandez-solutions-portal
```

```bash
npx vercel firewall traffic --project hernandez-solutions-portal
```

This shows traffic by action, the busiest rules, and the top clients (IPs). Check each project.

**2. Turn on Attack Mode for the affected site.** It shows every visitor a short browser check before the site. Google and other search engines, Vercel Cron and known webhook providers are let through. It takes effect immediately, and blocked traffic is free.

```bash
npx vercel firewall attack-mode enable --project hernandez-solutions-portal --duration 6h
```

Durations: `1h`, `6h` or `24h`. You can also use the dashboard: Vercel → the project → Firewall → Bot Management → Attack Mode → Enable.

While it's on, these may fail: one-click unsubscribe from mail apps, the CRM calendar feed, and any script or API client. Turn it off as soon as the attack stops.

**3. If it's a few sources, block them.** Hobby allows 10 IP blocks per project. A block is staged first, then published:

```bash
npx vercel firewall ip-blocks block 203.0.113.7 --project hernandez-solutions-portal
```

```bash
npx vercel firewall publish --project hernandez-solutions-portal --yes
```

Use a CIDR range (for example `203.0.113.0/24`) for a whole network. Remove a block with `ip-blocks unblock <ip>`, then publish.

**4. If one path is being hammered, use the free rule slot,** for example to challenge or deny it:

```bash
npx vercel firewall rules add "Incident: challenge sign-in" --project hernandez-solutions-portal --condition '{"type":"path","op":"pre","value":"/signin"}' --action challenge --yes
```

```bash
npx vercel firewall publish --project hernandez-solutions-portal --yes
```

To tighten a rate limit temporarily, update it (for example 600 → 120 per minute) and publish:

```bash
npx vercel firewall rules update "Rate limit per IP" --project hernandez-solutions-portal --rate-limit-requests 120 --rate-limit-window 60 --yes
```

Run `npx vercel firewall diff --project <name>` before publishing to check what will change.

**5. Protect the bill.** Attacks often target cost rather than uptime:

- **Neon** (portal and CRM databases): check compute usage, and lower the autoscaling maximum if it's climbing.
- **Resend:** if forms are being abused, the website's form limit and the firewall's `/api/*` limit apply. Check the Resend dashboard for unusual sending.
- **Anthropic:** if API keys are added, keep a monthly spend limit on them.

## After the incident

1. Turn Attack Mode off:

   ```bash
   npx vercel firewall attack-mode disable --project hernandez-solutions-portal
   ```

2. Remove temporary rules and IP blocks (`rules remove "<name>"`, `ip-blocks unblock <ip>`), then publish.
3. Re-export the configuration to `docs/firewall/` and note what happened in the project log.

**Undo a bad rule fast:** `npx vercel firewall rules disable "<name>" --project <name> --yes`, then `publish`. Or, before publishing, `npx vercel firewall discard --project <name>` throws away all draft changes.

## When the team moves to Vercel Pro

Pro is required for commercial use under Vercel's terms ("Hobby teams are restricted to non-commercial personal use only"), and it unlocks:

- **Spend Management:** a monthly budget that can pause the sites instead of running up a bill. Set it first.
- **System bypass rules:** exempt the machine traffic listed above. Bot Protection on the portal and CRM can then move from Log to **Challenge**.
- **Persistent actions:** block an offending IP for a set time (for example 15 minutes) before it reaches the firewall.
- **40 rules per project:** add tighter limits such as portal `/signin` and `/api/auth/*` at 20/min, CRM `/login` at 10/min, and website `/api/leads` and `/api/newsletter` at 5/min.

## Still to do (not firewall)

- **Website forms:** add Cloudflare Turnstile (bot check) and Upstash Redis (shared rate limit) keys in Vercel. The code already uses them as soon as the keys exist (see the website's `docs/DEPLOYMENT.md`). Until then the website's own form limit is per server instance, and the firewall's `/api/*` limit is the real protection.
