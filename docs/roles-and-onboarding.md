# Customer onboarding and role management

All steps are done by a **platform operator** in *Administration* (`/portal/admin`). Operators administer the platform; they do not see tickets unless they are also given a technician or service-manager role for a customer.

## Bootstrap the first operator (one time per environment)

There is deliberately no self-service way to become an operator. After the first deploy, run once against the environment's database (from a trusted machine, with that environment's `DATABASE_URL`):

```sql
-- 1. The Hernandez Solutions home directory
insert into entra_directories (tenant_id, display_name, kind) values ('<HS tenant ID>', 'Hernandez Solutions', 'msp');
-- 2. The operator account, bound to their Entra object ID (Entra admin center → Users → the user → Object ID)
with u as (insert into users (email, display_name, is_platform_operator) values ('<email>', '<name>', true) returning id)
insert into user_identities (user_id, tenant_id, object_id) select id, '<HS tenant ID>', '<object ID>' from u;
```

Technicians in the Hernandez Solutions directory are then invited from the UI like anyone else.

## Onboard a customer

1. **Create the customer** (name + short ID). This creates only the internal record.
2. **Map their Entra directory**: the customer's *Tenant ID* (Entra admin center → Overview). One directory can belong to only one customer. Leave *inventory* off until consent is recorded.
3. **Grant access to people**: name, contact email, role, and the directory they sign in from.
   - *Requester* / *Client administrator* must sign in from a directory mapped to this customer.
   - *Technician* / *Service manager* must sign in from the Hernandez Solutions directory. Assign them to each customer explicitly; there is no "all customers" role.
   - If the person has never signed in, the portal returns a **one-time invitation link** (valid 7 days). Send it privately. It only works for a sign-in from the directory you entered.
4. *(Optional)* **Intune inventory**: complete the consent steps in [microsoft-setup.md](microsoft-setup.md), then record consent (below) and enable inventory for the directory.
5. *(Optional)* **Atera**: map the Atera customer ID; a read-only verification job confirms the record exists before any import uses it.

Recording admin consent (until a UI action exists):

```sql
update entra_directories set inventory_consent_at = now() where tenant_id = '<customer tenant ID>';
```

## Change or remove access

- **Change a role**: revoke, then grant the new role.
- **Revoke**: takes effect on the person's next request. If it was their last membership, their sessions are ended immediately.
- **Offboard a customer**: mark *offboarded*; all its people lose access at once. See the offboarding runbook in [security.md](security.md).

## Rules the system enforces

- Access is never granted from an email domain, customer name, URL parameter, browser-supplied role, or simply being in a Microsoft directory.
- A person is identified by `(tenant ID, object ID)`. An MSP technician signing in from the Hernandez Solutions directory can be assigned to customers in other directories.
- Every grant, revoke, mapping and status change is written to the audit log with the operator's identity.
