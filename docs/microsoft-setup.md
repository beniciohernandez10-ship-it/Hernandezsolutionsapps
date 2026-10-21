# Microsoft Entra ID and Graph: registration and consent

Two **separate** app registrations, both created in the Hernandez Solutions Entra tenant:

| Registration | Purpose | Permissions | Used by |
| --- | --- | --- | --- |
| *Hernandez Solutions IT Center (sign-in)* | Users sign in to the portal | Delegated: `openid`, `profile`, `email` | `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` |
| *Hernandez Solutions IT Center (inventory)* | Background, read-only Intune inventory and directory user lookup per customer | Application: `DeviceManagementManagedDevices.Read.All`, `User.Read.All` | `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` |

Keeping them separate means a user signing in never grants device access, and inventory access can be consented, audited and revoked per customer independently.

> Live registration and consent have **not** been performed or validated yet. Endpoint and permission names were checked against Microsoft Learn ("List managedDevices", Graph v1.0) at the time of writing; re-check before go-live.

## 1. Sign-in registration

Entra admin center → Identity → Applications → App registrations → New registration.

- **Supported account types:** *Accounts in any organizational directory (multitenant)*. Customers sign in from their own tenants; the portal then only accepts tenants an operator has approved.
- **Redirect URI (Web):** exactly `https://portal.thehernandezsolutions.com/api/auth/callback`. Add one per environment, e.g. the staging URL and `http://localhost:3000/api/auth/callback` for local testing. Exact match only; no wildcards.
- **Front-channel logout URL:** `https://portal.thehernandezsolutions.com/signed-out`.
- **Certificates & secrets:** create a client secret (or, preferably, a certificate/federated credential when moving to Azure-hosted infrastructure). Copy the value straight into Vercel → Project → Settings → Environment Variables → `ENTRA_CLIENT_SECRET`. Do not paste it anywhere else.
- **Token configuration:** optional claims `email` (ID token). The app does not rely on email for access.
- **API permissions:** Microsoft Graph delegated `openid`, `profile`, `email` (no admin consent needed for these).
- Set `ENTRA_CLIENT_ID` (Application (client) ID) and keep `ENTRA_AUTHORITY_TENANT=organizations`.

**Customer consent for sign-in:** the first user from a customer tenant may be asked to consent to "Sign you in and read your profile". Tenants that block user consent need an administrator to approve the app once (Enterprise applications → the app → Permissions → Grant admin consent), or to visit:
`https://login.microsoftonline.com/{customer-tenant-id}/adminconsent?client_id={ENTRA_CLIENT_ID}`

**MFA and Conditional Access:** customers' policies apply to this app like any other. If a customer targets "All cloud apps", users must satisfy those policies to reach the portal. Nothing in the portal bypasses them.

## 2. Inventory registration (Intune via Graph)

- **Supported account types:** multitenant.
- **API permissions:** Microsoft Graph → **Application** → `DeviceManagementManagedDevices.Read.All`, `User.Read.All` and `Organization.Read.All` (Microsoft 365 license counts on the Devices page; read-only). Do not add `ReadWrite`, `PrivilegedOperations`, or any wipe/retire/script permission.
- `User.Read.All` lets technicians pick a device's primary user from the customer's directory in the [device registry](asset-tags.md). The portal reads only `id`, `displayName`, `userPrincipalName`, `mail` and `accountEnabled`.
- Create a client secret → Vercel `GRAPH_CLIENT_SECRET`; set `GRAPH_CLIENT_ID`.

**Per-customer admin consent** (a Global Administrator or Privileged Role Administrator *of the customer tenant* must approve):

`https://login.microsoftonline.com/{customer-tenant-id}/adminconsent?client_id={GRAPH_CLIENT_ID}`

Requirements to tell the customer:
- They need active **Microsoft Intune** licensing for devices to appear.
- Consent lets Hernandez Solutions read device name, operating system, compliance state, last check-in and the Entra device ID, and look up users' names and sign-in addresses to assign devices. It does not allow changes, wipes, restarts or scripts.
- Customers who consented before `User.Read.All` was added must consent again (same link) before directory search works. Until then the picker offers the customer's portal members.
- They can revoke it any time: Enterprise applications → *Hernandez Solutions IT Center (inventory)* → Delete or remove permissions.

After consent, an operator records it (`entra_directories.inventory_consent_at`) and enables inventory for the directory. Imports run each time the cron fires (daily on Vercel Hobby, hourly on Pro) via the job queue.

## How the portal validates sign-in

See [security.md](security.md#authentication). In short: PKCE + state + nonce; signature, audience, lifetime, issuer-for-tid and approved-tenant checks; then `(tid, oid)` must map to a provisioned user with an active membership. Obtaining a Microsoft token is never enough on its own.

## Azure subscriptions

`customer_azure_subscriptions` stores subscription IDs for reference only. Azure resource management (ARM) is a separate integration with its own consent model and is **not** implemented.
