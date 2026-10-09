import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { addMessage, createTicket, getTicket, linkDevice, listDevices, listTickets, updateTicket, dashboard, recentAudit } from "@/lib/tickets/service";
import { withUser, asSystem, type Database } from "@/lib/db";

const U = DEMO.users;
const C = DEMO.customers;
let database: Database;

async function newTicket(userId: string, title = "Printer offline in lobby", extra: object = {}) {
  const p = await principal(userId);
  return createTicket(p, { title, description: "Details here", priority: "normal", category: "hardware", ...extra }, randomUUID());
}

beforeAll(async () => {
  database = await freshDatabase();
});

describe("cross-customer isolation", () => {
  it("lists only tickets from the viewer's customers", async () => {
    const fabAdmin = await principal(U.fabrikamAdmin);
    const list = await listTickets(fabAdmin, { pageSize: 100 });
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.every((t) => t.customerId === C.fabrikam)).toBe(true);
  });

  it("denies reading another customer's ticket (404, no existence leak)", async () => {
    const t = await newTicket(U.contosoRequester);
    await expectAppError(getTicket(await principal(U.fabrikamAdmin), t.id), 404, "not_found");
    await expectAppError(getTicket(await principal(U.techFabrikam), t.id), 404, "not_found");
  });

  it("denies replying to or updating another customer's ticket", async () => {
    const t = await newTicket(U.contosoRequester);
    await expectAppError(addMessage(await principal(U.fabrikamAdmin), t.id, { body: "hi" }), 404);
    await expectAppError(updateTicket(await principal(U.techFabrikam), t.id, { expectedVersion: 1, status: "resolved" }), 404);
  });

  it("denies filtering by a customer the viewer does not belong to", async () => {
    await expectAppError(listTickets(await principal(U.contosoAdmin), { customerId: C.fabrikam }), 403);
  });

  it("denies creating a ticket for another customer", async () => {
    const p = await principal(U.contosoRequester);
    await expectAppError(
      createTicket(p, { title: "Sneaky", description: "x", priority: "low", category: "other", customerId: C.fabrikam }, randomUUID()),
      403,
    );
  });

  it("denies linking a device from another customer", async () => {
    const t = await newTicket(U.contosoAdmin);
    const fabDevices = await listDevices(await principal(U.fabrikamAdmin));
    await expectAppError(linkDevice(await principal(U.contosoAdmin), t.id, fabDevices.devices[0].id), 404);
  });

  it("technicians only see explicitly assigned customers", async () => {
    const tess = await principal(U.tech);
    const list = await listTickets(tess, { pageSize: 100 });
    expect(list.items.every((t) => t.customerId === C.contoso)).toBe(true);
    await expectAppError(listDevices(tess, C.fabrikam), 403);
  });

  it("platform operators get no ticket access without a membership", async () => {
    const op = await principal(U.operator);
    const list = await listTickets(op, {});
    expect(list.items).toHaveLength(0);
    expect(await dashboard(op)).toBeNull();
  });
});

describe("requester isolation", () => {
  it("requesters only see their own tickets", async () => {
    const t = await newTicket(U.contosoRequester2, "Rowan's private issue");
    const riley = await principal(U.contosoRequester);
    const list = await listTickets(riley, { pageSize: 100, q: "Rowan" });
    expect(list.items).toHaveLength(0);
    await expectAppError(getTicket(riley, t.id), 404);
    await expectAppError(addMessage(riley, t.id, { body: "peek" }), 404);
  });

  it("requesters cannot view device inventory", async () => {
    await expectAppError(listDevices(await principal(U.contosoRequester)), 403);
  });

  it("requesters cannot change priority or assignment", async () => {
    const t = await newTicket(U.contosoRequester);
    const p = await principal(U.contosoRequester);
    await expectAppError(updateTicket(p, t.id, { expectedVersion: 1, priority: "urgent" }), 403);
    await expectAppError(updateTicket(p, t.id, { expectedVersion: 1, assigneeUserId: U.tech }), 403);
  });
});

describe("client administrator restrictions", () => {
  it("sees the whole organization's tickets but not internal notes", async () => {
    const t = await newTicket(U.contosoRequester, "Admin visibility check");
    const tech = await principal(U.tech);
    await addMessage(tech, t.id, { body: "INTERNAL: password reset via admin portal", visibility: "internal" });
    await addMessage(tech, t.id, { body: "We're on it.", visibility: "public" });
    const admin = await principal(U.contosoAdmin);
    const detail = await getTicket(admin, t.id);
    expect(detail.messages.map((m) => m.body)).toEqual(["We're on it."]);
    expect(detail.viewer.canAddInternalNote).toBe(false);
  });

  it("cannot add internal notes", async () => {
    const t = await newTicket(U.contosoRequester);
    await expectAppError(addMessage(await principal(U.contosoAdmin), t.id, { body: "x", visibility: "internal" }), 403);
  });

  it("cannot assign technicians", async () => {
    const t = await newTicket(U.contosoRequester);
    await expectAppError(updateTicket(await principal(U.contosoAdmin), t.id, { expectedVersion: 1, assigneeUserId: U.tech }), 403);
  });

  it("cannot read the audit log", async () => {
    await expectAppError(recentAudit(await principal(U.contosoAdmin), C.contoso), 403);
  });
});

describe("private-note confidentiality", () => {
  it("requester never receives internal notes", async () => {
    const t = await newTicket(U.contosoRequester, "Note confidentiality");
    await addMessage(await principal(U.tech), t.id, { body: "secret note", visibility: "internal" });
    const detail = await getTicket(await principal(U.contosoRequester), t.id);
    expect(detail.messages.some((m) => m.visibility === "internal")).toBe(false);
    expect(JSON.stringify(detail)).not.toContain("secret note");
  });

  it("RLS hides internal notes even if application filtering were bypassed", async () => {
    const t = await newTicket(U.contosoRequester, "RLS note check");
    await addMessage(await principal(U.tech), t.id, { body: "rls-secret", visibility: "internal" });
    const rows = await withUser(U.contosoRequester, (tx) => tx.query("select body from ticket_messages where ticket_id = $1", [t.id]));
    expect(rows.rows.map((r) => r.body)).not.toContain("rls-secret");
    const adminRows = await withUser(U.contosoAdmin, (tx) => tx.query("select body from ticket_messages where ticket_id = $1", [t.id]));
    expect(adminRows.rows.map((r) => r.body)).not.toContain("rls-secret");
  });
});

describe("database-level tenant safeguards", () => {
  it("RLS returns no rows from another customer even with an unscoped query", async () => {
    const r = await withUser(U.fabrikamAdmin, (tx) => tx.query<{ customer_id: string }>("select customer_id from tickets"));
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.customer_id === C.fabrikam)).toBe(true);
  });

  it("RLS blocks inserting a ticket into another customer", async () => {
    await expect(
      withUser(U.fabrikamAdmin, (tx) =>
        tx.query(
          "insert into tickets (customer_id, requester_user_id, title, description, priority, category) values ($1, $2, 'xxx', 'y', 'low', 'other')",
          [C.contoso, U.fabrikamAdmin],
        ),
      ),
    ).rejects.toThrow();
  });

  it("RLS blocks requesters from inserting internal notes directly", async () => {
    const t = await newTicket(U.contosoRequester);
    await expect(
      withUser(U.contosoRequester, (tx) =>
        tx.query(
          "insert into ticket_messages (ticket_id, customer_id, author_user_id, visibility, body) values ($1, $2, $3, 'internal', 'x')",
          [t.id, C.contoso, U.contosoRequester],
        ),
      ),
    ).rejects.toThrow();
  });

  it("composite keys reject a message whose customer differs from its ticket", async () => {
    const t = await newTicket(U.contosoRequester);
    await expect(
      asSystem((tx) =>
        tx.query(
          "insert into ticket_messages (ticket_id, customer_id, author_user_id, visibility, body) values ($1, $2, $3, 'public', 'x')",
          [t.id, C.fabrikam, U.fabrikamAdmin],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("a ticket's customer cannot be changed", async () => {
    const t = await newTicket(U.contosoRequester);
    await expect(asSystem((tx) => tx.query("update tickets set customer_id = $2 where id = $1", [t.id, C.fabrikam]))).rejects.toThrow(
      /cannot change/,
    );
  });

  it("assignees must be staff assigned to the ticket's customer", async () => {
    const t = await newTicket(U.contosoRequester);
    await expectAppError(updateTicket(await principal(U.tech), t.id, { expectedVersion: 1, assigneeUserId: U.techFabrikam }), 422);
    await expect(asSystem((tx) => tx.query("update tickets set assignee_user_id = $2 where id = $1", [t.id, U.techFabrikam]))).rejects.toThrow(
      /assignee/,
    );
  });

  it("the restricted role cannot read session or auth tables", async () => {
    await expect(withUser(U.contosoAdmin, (tx) => tx.query("select * from sessions"))).rejects.toThrow(/permission denied/);
    await expect(withUser(U.contosoAdmin, (tx) => tx.query("select * from atera_connections"))).rejects.toThrow(/permission denied/);
  });
});

describe("revoked memberships", () => {
  it("revocation removes access immediately", async () => {
    const t = await newTicket(U.contosoRequester2, "Before revocation");
    const before = await principal(U.contosoRequester2);
    await asSystem((tx) =>
      tx.query("update memberships set revoked_at = now() where user_id = $1 and customer_id = $2", [U.contosoRequester2, C.contoso]),
    );
    const after = await principal(U.contosoRequester2);
    expect(after.memberships).toHaveLength(0);
    await expectAppError(getTicket(after, t.id), 404);
    // Even a stale principal object is stopped by RLS at the database.
    const rows = await withUser(before.userId, (tx) => tx.query("select id from tickets where id = $1", [t.id]));
    expect(rows.rows).toHaveLength(0);
    await asSystem((tx) =>
      tx.query("update memberships set revoked_at = null where user_id = $1 and customer_id = $2", [U.contosoRequester2, C.contoso]),
    );
  });

  it("offboarded customers lose access", async () => {
    await asSystem((tx) => tx.query("update customers set status = 'offboarded' where id = $1", [C.fabrikam]));
    const p = await principal(U.fabrikamAdmin);
    expect(p.memberships).toHaveLength(0);
    const rows = await withUser(U.fabrikamAdmin, (tx) => tx.query("select id from tickets"));
    expect(rows.rows).toHaveLength(0);
    await asSystem((tx) => tx.query("update customers set status = 'active' where id = $1", [C.fabrikam]));
  });
});

describe("dashboard metrics", () => {
  it("counts only tickets in the viewer's scope", async () => {
    const riley = await principal(U.contosoRequester);
    const d = await dashboard(riley);
    const mine = await listTickets(riley, { status: "active", pageSize: 100 });
    expect(d!.open + d!.inProgress + d!.waiting).toBe(mine.total);
  });
});
