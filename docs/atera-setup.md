# Atera configuration and contract verification

## Status

The Atera adapter (`src/lib/integrations/atera.ts`) is **read-only and not yet verified** against the Hernandez Solutions Atera account. Atera's interactive API reference could not be read from the build environment, so the request shapes come from Atera's public v3 API as used by community clients and are isolated in the `ATERA_CONTRACT` constant. **Do not enable imports for a real customer until the checklist below passes.**

What the adapter does today:

- `verifyAteraMapping`: `GET /api/v3/customers/{ateraCustomerId}` and confirms the returned `CustomerID` equals the mapping.
- `syncAteraAgents`: `GET /api/v3/agents/customer/{ateraCustomerId}` with `itemsInPage=50`, following `nextLink`; imports agents as devices only if **every** record's `CustomerID` matches the mapping (otherwise nothing is imported and the sync is marked *needs review*).
- No ticket, contact or comment reads/writes yet. Ticket writes are hard-disabled in the job runner.

## Configure an Atera account

1. In Atera: Admin → API → generate an API key (use the most restricted key type your plan offers).
2. In Vercel → Project → Settings → Environment Variables, add `ATERA_API_KEY` (or `ATERA_API_KEY_<NAME>` for additional accounts) per environment. Never paste the key into chat or the repo.
3. Register the connection (stores only the variable *name*):
   ```sql
   insert into atera_connections (name, api_key_env_var) values ('Hernandez Solutions Atera', 'ATERA_API_KEY');
   ```
4. For each customer: Administration → *Map Atera customer* with the Atera **Customer ID** (Atera → Customers → the customer; the numeric ID in the URL). A verification job is queued; the mapping is used only after it is verified.

An Atera API key is account-wide: it can read every customer in the account. The portal therefore treats the key as broader than any one customer's authorization and checks ownership on every imported record.

## Contract verification checklist

Run each against the real account (from a trusted machine, key in an environment variable, never in shell history) and record the result in this file.

| # | Check | Expected by the adapter | Verified? |
| --- | --- | --- | --- |
| 1 | Base URL and auth | `https://app.atera.com/api/v3`, header `X-API-KEY` | ☐ |
| 2 | Single customer | `GET /customers/{id}` returns an object with numeric `CustomerID` and `CustomerName` | ☐ |
| 3 | Agents by customer | `GET /agents/customer/{id}` exists and returns only that customer's agents | ☐ |
| 4 | Agent fields | `AgentID` (number), `CustomerID` (number), `MachineName`, `OSType`, `OS` | ☐ |
| 5 | Pagination | Response has `items` array and `nextLink` (absolute URL on `app.atera.com`, empty/absent on last page); `itemsInPage` honored, max page size | ☐ |
| 6 | Not found | Unknown customer returns 404 (adapter treats 404 as "not found", not as an empty list) | ☐ |
| 7 | Throttling | Status code and headers when rate-limited (429? `Retry-After`?); account-wide quota per minute/hour | ☐ |
| 8 | Redirects | API never redirects (adapter refuses redirects) | ☐ |
| 9 | Plan entitlements | API access available on the current Atera plan; any per-endpoint restrictions | ☐ |
| 10 | Webhooks | Whether Atera offers outbound webhooks for tickets on this plan (affects phase 5 design) | ☐ |

Example (read-only):

```bash
curl -sS -H "X-API-KEY: $ATERA_API_KEY" -H "Accept: application/json" \
  "https://app.atera.com/api/v3/agents/customer/<id>?itemsInPage=5" | jq '{keys: (.|keys), first: .items[0] | keys}'
```

When a check differs, change `ATERA_CONTRACT` (one place), update `tests/integration/providers.test.ts` fixtures to the real shape, and set `verified: true` only after all ten pass.

## Next phase

Ticket import (read-only) and then controlled bidirectional sync follow [atera-sync-design.md](atera-sync-design.md).
