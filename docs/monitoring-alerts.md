# Monitoring alerts

Monitoring turns problems into requests automatically. Each alert is "one problem" (per client); the first time it's seen it can open a request from the **IT Center Monitoring** account, repeats are counted on the same alert (no duplicate requests), and when the problem clears the request gets an internal note and, if nobody has picked it up (still open, unassigned, no replies), is resolved automatically.

Technicians see alerts under **Alerts** in the sidebar (open and cleared, with the request each one opened). Assignment rules apply to monitoring requests like any other, so you can route, say, all `security` requests from monitoring to one technician.

## Built-in checks

Administration → **Monitoring** → *Built-in checks*, per client. They run at most once an hour while the portal is in use, and on the daily cron.

| Check | Raises | Request | Clears when |
| --- | --- | --- | --- |
| Not compliant in Intune | A device Intune reports as not compliant, in error or in conflict | Normal priority, Security | It's compliant again or removed |
| Not checked in | An Intune or Atera device that hasn't checked in for N days (default 14) | Normal priority, Hardware | It checks in again or is removed |
| Warranty ending | An active asset whose warranty ends within N days (default 30), or ended in the last 30 | Low priority, Hardware | The warranty date changes or the asset is retired; **the request is only noted, never auto-resolved** |
| No spare licenses | A Microsoft 365 SKU with every license assigned | Normal priority, Account access | A license frees up or more are bought |

Intune checks need Intune connected for the client (`docs/microsoft-setup.md`); licenses need the license sync.

## Connected tools (webhook)

Administration → **Monitoring** → *Connect a tool* gives each tool an address and a secret token (shown once; **Rotate token** issues a new one and the old one stops working immediately). A tool covers one client, or several clients matched by their Atera customer ID (the client must have a verified Atera mapping).

Send each alert as JSON:

```
POST https://portal.thehernandezsolutions.com/api/alerts/<source id>
Authorization: Bearer <token>        (or X-Alert-Token: <token>)
Content-Type: application/json

{
  "id": "disk-c-PC01",                 required: the same id for the same problem
  "title": "Disk C: almost full on PC01",
  "severity": "warning",               info | warning | critical (also low/medium/high, error, p1/p2…)
  "status": "firing",                  firing (default) | resolved (also ok, closed, cleared, recovered, up)
  "description": "92% used",           optional
  "device": "PC01",                    optional: linked to the device with that name
  "ateraCustomerId": 12345,            only for multi-client sources
  "url": "https://…"                   optional link back to the tool
}
```

- Alerts at or above the source's threshold (*Open a request for*) open a request: critical → high priority, warning → normal, info → low. Below the threshold they're recorded under Alerts only.
- Send `"status": "resolved"` with the same `id` when it clears.
- Responses: `202` with `{"status": "opened" | "updated" | "cleared" | "no_open_alert"}`, `401` bad token, `422` invalid alert, `413` over 64 KB, `429` too many (120 a minute per IP).

Every alert, cleared alert, request opened, settings change and token change is in the audit log (`monitoring.*`).
