import type { Database, Queryable } from "./index";

/**
 * Fictional demonstration data. Every organisation and person below is made
 * up, uses example.com addresses, and is flagged is_demo = true so it can be
 * removed with `deleteDemoData`. Directory IDs are placeholders, not real tenants.
 */
export const DEMO = {
  directories: {
    msp: "00000000-0000-4000-8000-00000000a001",
    contoso: "00000000-0000-4000-8000-00000000c001",
    fabrikam: "00000000-0000-4000-8000-00000000f001",
  },
  customers: {
    contoso: "11111111-1111-4111-8111-111111111111",
    fabrikam: "22222222-2222-4222-8222-222222222222",
  },
  users: {
    operator: "aaaaaaaa-0000-4000-8000-000000000001",
    manager: "aaaaaaaa-0000-4000-8000-000000000002",
    tech: "aaaaaaaa-0000-4000-8000-000000000003",
    techFabrikam: "aaaaaaaa-0000-4000-8000-000000000004",
    contosoAdmin: "bbbbbbbb-0000-4000-8000-000000000001",
    contosoRequester: "bbbbbbbb-0000-4000-8000-000000000002",
    contosoRequester2: "bbbbbbbb-0000-4000-8000-000000000003",
    fabrikamAdmin: "cccccccc-0000-4000-8000-000000000001",
    fabrikamRequester: "cccccccc-0000-4000-8000-000000000002",
  },
} as const;

export const DEMO_PERSONAS: { id: string; label: string; description: string }[] = [
  { id: DEMO.users.contosoRequester, label: "Riley Rivera (Demo)", description: "Requester at Contoso Dental (Demo)" },
  { id: DEMO.users.contosoRequester2, label: "Rowan Reed (Demo)", description: "Second requester at Contoso Dental (Demo)" },
  { id: DEMO.users.contosoAdmin, label: "Cora Chen (Demo)", description: "Client administrator at Contoso Dental (Demo)" },
  { id: DEMO.users.fabrikamAdmin, label: "Fiona Flores (Demo)", description: "Client administrator at Fabrikam CPA (Demo)" },
  { id: DEMO.users.tech, label: "Tess Torres (Demo)", description: "Technician assigned to Contoso Dental (Demo)" },
  { id: DEMO.users.manager, label: "Sam Santos (Demo)", description: "Service manager for both demo customers" },
  { id: DEMO.users.operator, label: "Olivia Ortiz (Demo)", description: "Platform operator (no ticket access)" },
];

async function exists(tx: Queryable) {
  const r = await tx.query("select 1 from customers where id = $1", [DEMO.customers.contoso]);
  return r.rows.length > 0;
}

export async function seedDemo(database: Database): Promise<boolean> {
  return database.transaction(async (tx) => {
    if (await exists(tx)) return false;
    const d = DEMO;

    await tx.query(
      `insert into entra_directories (tenant_id, display_name, kind) values
        ($1, 'Hernandez Solutions (Demo directory)', 'msp'),
        ($2, 'Contoso Dental (Demo directory)', 'customer'),
        ($3, 'Fabrikam CPA (Demo directory)', 'customer')`,
      [d.directories.msp, d.directories.contoso, d.directories.fabrikam],
    );
    await tx.query(
      `insert into customers (id, slug, name, is_demo) values
        ($1, 'demo-contoso-dental', 'Contoso Dental (Demo)', true),
        ($2, 'demo-fabrikam-cpa', 'Fabrikam CPA (Demo)', true)`,
      [d.customers.contoso, d.customers.fabrikam],
    );
    await tx.query(
      `insert into customer_entra_directories (customer_id, directory_id)
         select $1::uuid, id from entra_directories where tenant_id = $2
         union all select $3::uuid, id from entra_directories where tenant_id = $4`,
      [d.customers.contoso, d.directories.contoso, d.customers.fabrikam, d.directories.fabrikam],
    );

    const users: [string, string, string, boolean, string][] = [
      [d.users.operator, "olivia.ortiz@example.com", "Olivia Ortiz (Demo)", true, d.directories.msp],
      [d.users.manager, "sam.santos@example.com", "Sam Santos (Demo)", false, d.directories.msp],
      [d.users.tech, "tess.torres@example.com", "Tess Torres (Demo)", false, d.directories.msp],
      [d.users.techFabrikam, "theo.tran@example.com", "Theo Tran (Demo)", false, d.directories.msp],
      [d.users.contosoAdmin, "cora.chen@example.com", "Cora Chen (Demo)", false, d.directories.contoso],
      [d.users.contosoRequester, "riley.rivera@example.com", "Riley Rivera (Demo)", false, d.directories.contoso],
      [d.users.contosoRequester2, "rowan.reed@example.com", "Rowan Reed (Demo)", false, d.directories.contoso],
      [d.users.fabrikamAdmin, "fiona.flores@example.com", "Fiona Flores (Demo)", false, d.directories.fabrikam],
      [d.users.fabrikamRequester, "felix.ford@example.com", "Felix Ford (Demo)", false, d.directories.fabrikam],
    ];
    for (const [id, email, name, op, tid] of users) {
      await tx.query(
        "insert into users (id, email, display_name, is_platform_operator, is_demo) values ($1, $2, $3, $4, true)",
        [id, email, name, op],
      );
      // Placeholder object IDs: the demo personas never sign in through Entra.
      await tx.query("insert into user_identities (user_id, tenant_id, object_id) values ($1, $2, gen_random_uuid())", [
        id,
        tid,
      ]);
    }

    const memberships: [string, string, string][] = [
      [d.users.manager, d.customers.contoso, "service_manager"],
      [d.users.manager, d.customers.fabrikam, "service_manager"],
      [d.users.tech, d.customers.contoso, "technician"],
      [d.users.techFabrikam, d.customers.fabrikam, "technician"],
      [d.users.contosoAdmin, d.customers.contoso, "client_admin"],
      [d.users.contosoRequester, d.customers.contoso, "requester"],
      [d.users.contosoRequester2, d.customers.contoso, "requester"],
      [d.users.fabrikamAdmin, d.customers.fabrikam, "client_admin"],
      [d.users.fabrikamRequester, d.customers.fabrikam, "requester"],
    ];
    for (const [u, c, role] of memberships) {
      await tx.query("insert into memberships (user_id, customer_id, role, granted_by) values ($1, $2, $3, $4)", [
        u,
        c,
        role,
        d.users.operator,
      ]);
    }

    await tx.query("insert into queues (name) values ('Service desk'), ('Projects') on conflict do nothing");

    const devices: [string, string, string, string, string][] = [
      [d.customers.contoso, "CD-FRONTDESK-01 (Demo)", "Windows", "10.0.26100", "compliant"],
      [d.customers.contoso, "CD-HYGIENE-02 (Demo)", "Windows", "10.0.22631", "noncompliant"],
      [d.customers.contoso, "Cora's iPhone (Demo)", "iOS", "18.5", "compliant"],
      [d.customers.fabrikam, "FAB-PARTNER-LT (Demo)", "macOS", "15.5", "inGracePeriod"],
      [d.customers.fabrikam, "FAB-SCANNER-PC (Demo)", "Windows", "10.0.19045", "unknown"],
    ];
    const deviceIds: string[] = [];
    for (const [c, name, os, ver, comp] of devices) {
      const r = await tx.query<{ id: string }>(
        `insert into devices (customer_id, source, name, operating_system, os_version, compliance_state, last_provider_sync_at)
         values ($1, 'demo', $2, $3, $4, $5, now() - interval '3 hours') returning id`,
        [c, name, os, ver, comp],
      );
      deviceIds.push(r.rows[0].id);
    }

    type T = [string, string, string, string, string, string, string, string | null];
    const tickets: T[] = [
      [d.customers.contoso, d.users.contosoRequester, "Front desk PC cannot print to reception printer (Demo)",
        "Since this morning the front desk computer shows the printer as offline. Other computers can print.", "high", "hardware", "in_progress", d.users.tech],
      [d.customers.contoso, d.users.contosoRequester2, "New hire needs Microsoft 365 account (Demo)",
        "Please create an account for a new hygienist starting Monday.", "normal", "account_access", "open", null],
      [d.customers.contoso, d.users.contosoAdmin, "Compliance warning on hygiene room PC (Demo)",
        "The hygiene room PC is reported as not compliant. Can you check what is missing?", "normal", "security", "waiting", d.users.tech],
      [d.customers.fabrikam, d.users.fabrikamRequester, "Outlook keeps asking for password (Demo)",
        "Outlook on my laptop prompts for my password several times per day.", "normal", "email", "open", null],
      [d.customers.fabrikam, d.users.fabrikamAdmin, "Quarterly access review (Demo)",
        "Please send the list of users with admin rights for our quarterly review.", "low", "security", "resolved", d.users.techFabrikam],
    ];
    const ticketIds: string[] = [];
    for (const [c, req, title, desc, prio, cat, status, assignee] of tickets) {
      const r = await tx.query<{ id: string }>(
        `insert into tickets (customer_id, requester_user_id, title, description, priority, category, status, assignee_user_id,
                              created_at, updated_at, resolved_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now() - interval '2 days', now() - interval '1 hour',
                 case when $7 = 'resolved' then now() - interval '1 hour' end)
         returning id`,
        [c, req, title, desc, prio, cat, status, assignee],
      );
      const id = r.rows[0].id;
      ticketIds.push(id);
      await tx.query(
        "insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, to_value, created_at) values ($1, $2, $3, 'created', 'open', now() - interval '2 days')",
        [id, c, req],
      );
    }

    const msg = (i: number, author: string, vis: "public" | "internal", body: string) =>
      tx.query(
        "insert into ticket_messages (ticket_id, customer_id, author_user_id, visibility, body) select id, customer_id, $2, $3, $4 from tickets where id = $1",
        [ticketIds[i], author, vis, body],
      );
    await msg(0, d.users.tech, "public", "Thanks Riley. I'm connecting to the front desk PC now to check the print spooler.");
    await msg(0, d.users.tech, "internal", "Spooler service crashed after the last cumulative update. Plan: clear queue, reinstall driver.");
    await msg(2, d.users.tech, "public", "The device is missing the latest BitLocker escrow. Can someone restart it tonight so the policy applies?");
    await tx.query("update tickets set first_response_at = now() - interval '1 day' where id = any($1)", [[ticketIds[0], ticketIds[2]]]);
    await tx.query(
      "insert into ticket_devices (ticket_id, device_id, customer_id) values ($1, $2, $3), ($4, $5, $3)",
      [ticketIds[0], deviceIds[0], d.customers.contoso, ticketIds[2], deviceIds[1]],
    );
    await tx.query(
      `insert into sync_states (customer_id, provider, resource, status, last_attempt_at, last_success_at, records)
       values ($1, 'intune', 'managed_devices', 'synchronized', now() - interval '3 hours', now() - interval '3 hours', 3),
              ($2, 'intune', 'managed_devices', 'failed', now() - interval '1 hour', now() - interval '30 hours', 2)`,
      [d.customers.contoso, d.customers.fabrikam],
    );
    await tx.query(
      "update sync_states set last_error = 'Demo: provider returned 403 (consent not granted)' where customer_id = $1",
      [d.customers.fabrikam],
    );
    return true;
  });
}

export async function deleteDemoData(database: Database) {
  await database.transaction(async (tx) => {
    await tx.query("delete from tickets where customer_id in (select id from customers where is_demo)");
    await tx.query("delete from customers where is_demo");
    await tx.query("delete from users where is_demo");
    await tx.query("delete from entra_directories where tenant_id = any($1)", [Object.values(DEMO.directories)]);
  });
}
