import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { addMessage, autoCloseResolved, createTicket, getTicket, listTickets, updateTicket } from "@/lib/tickets/service";
import { asSystem } from "@/lib/db";

const U = DEMO.users;

beforeAll(async () => {
  await freshDatabase();
});

const input = (o: object = {}) => ({ title: "Laptop will not boot", description: "Black screen", priority: "high", category: "hardware", ...o });

describe("ticket creation", () => {
  it("derives customer and requester server-side", async () => {
    const p = await principal(U.contosoRequester);
    const r = await createTicket(p, input({ requesterUserId: U.contosoAdmin }), randomUUID());
    const t = await getTicket(p, r.id);
    expect(t.customerId).toBe(DEMO.customers.contoso);
    expect(t.requesterUserId).toBe(U.contosoRequester);
    expect(t.status).toBe("open");
    expect(t.events[0].kind).toBe("created");
  });

  it("duplicate submissions with the same idempotency key create one ticket", async () => {
    const p = await principal(U.contosoRequester);
    const key = randomUUID();
    const [a, b] = await Promise.all([createTicket(p, input({ title: "Dup check" }), key), createTicket(p, input({ title: "Dup check" }), key)]);
    expect(a.id).toBe(b.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const c = await createTicket(p, input({ title: "Dup check" }), key);
    expect(c.id).toBe(a.id);
    const list = await listTickets(p, { q: "Dup check" });
    expect(list.total).toBe(1);
  });

  it("rejects reusing a key for a different request", async () => {
    const p = await principal(U.contosoRequester);
    const key = randomUUID();
    await createTicket(p, input({ title: "First body" }), key);
    await expectAppError(createTicket(p, input({ title: "Second body" }), key), 409, "idempotency_conflict");
  });

  it("requires an idempotency key", async () => {
    await expectAppError(createTicket(await principal(U.contosoRequester), input(), ""), 400);
  });

  it("validates input", async () => {
    const p = await principal(U.contosoRequester);
    await expectAppError(createTicket(p, input({ title: "x" }), randomUUID()), 422);
    await expectAppError(createTicket(p, input({ priority: "critical" }), randomUUID()), 422);
    await expectAppError(createTicket(p, input({ description: "bad\u0000byte" }), randomUUID()), 422);
    await expectAppError(createTicket(p, input({ title: "a".repeat(201) }), randomUUID()), 422);
  });

  it("stores unsafe markup verbatim as text (rendered escaped by the UI)", async () => {
    const p = await principal(U.contosoRequester);
    const payload = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
    const r = await createTicket(p, input({ description: payload }), randomUUID());
    expect((await getTicket(p, r.id)).description).toBe(payload);
  });

  it("users with several customers must choose one", async () => {
    await expectAppError(createTicket(await principal(U.manager), input(), randomUUID()), 422);
    const r = await createTicket(await principal(U.manager), input({ customerId: DEMO.customers.fabrikam }), randomUUID());
    expect(r.number).toBeGreaterThan(0);
  });
});

describe("search, filters and pagination", () => {
  it("paginates and filters", async () => {
    const p = await principal(U.contosoAdmin);
    for (let i = 0; i < 5; i++) await createTicket(p, input({ title: `Paging sample ${i}`, priority: "low" }), randomUUID());
    const page1 = await listTickets(p, { q: "Paging sample", pageSize: 2, page: 1 });
    const page3 = await listTickets(p, { q: "Paging sample", pageSize: 2, page: 3 });
    expect(page1.total).toBe(5);
    expect(page1.items).toHaveLength(2);
    expect(page3.items).toHaveLength(1);
    const low = await listTickets(p, { priority: "low", q: "Paging" });
    expect(low.items.every((t) => t.priority === "low")).toBe(true);
  });

  it("treats LIKE wildcards in search as literals", async () => {
    const p = await principal(U.contosoAdmin);
    const all = await listTickets(p, { q: "%" });
    expect(all.total).toBe(0);
  });

  it("finds a ticket by number", async () => {
    const p = await principal(U.contosoAdmin);
    const r = await createTicket(p, input({ title: "Find me by number" }), randomUUID());
    const found = await listTickets(p, { q: `#${r.number}` });
    expect(found.items.map((t) => t.id)).toEqual([r.id]);
  });
});

describe("status lifecycle and concurrency", () => {
  it("rejects stale versions (optimistic concurrency)", async () => {
    const r = await createTicket(await principal(U.contosoRequester), input(), randomUUID());
    const tech = await principal(U.tech);
    const mgr = await principal(U.manager);
    const results = await Promise.allSettled([
      updateTicket(tech, r.id, { expectedVersion: 1, status: "in_progress" }),
      updateTicket(mgr, r.id, { expectedVersion: 1, status: "waiting" }),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("version_conflict");
  });

  it("sets first response time on the first public staff reply only", async () => {
    const r = await createTicket(await principal(U.contosoRequester), input(), randomUUID());
    const tech = await principal(U.tech);
    await addMessage(tech, r.id, { body: "internal first", visibility: "internal" });
    expect((await getTicket(tech, r.id)).firstResponseAt).toBeNull();
    await addMessage(tech, r.id, { body: "public reply" });
    const first = (await getTicket(tech, r.id)).firstResponseAt;
    expect(first).not.toBeNull();
    await addMessage(tech, r.id, { body: "second reply" });
    expect((await getTicket(tech, r.id)).firstResponseAt).toBe(first);
  });

  it("customer reply on a waiting ticket moves it back to open", async () => {
    const req = await principal(U.contosoRequester);
    const r = await createTicket(req, input(), randomUUID());
    await updateTicket(await principal(U.tech), r.id, { expectedVersion: 1, status: "waiting" });
    const m = await addMessage(req, r.id, { body: "Here is the info" });
    expect(m.status).toBe("open");
  });

  it("requesters may confirm their own ticket is fixed, and reopen it while it is resolved", async () => {
    const req = await principal(U.contosoRequester);
    const r = await createTicket(req, input(), randomUUID());
    const resolved = await updateTicket(req, r.id, { expectedVersion: 1, status: "resolved" });
    const done = await getTicket(req, r.id);
    expect(done.resolvedAt).not.toBeNull();
    expect(done.resolutionNote).toBe("Confirmed fixed by the requester.");
    await updateTicket(req, r.id, { expectedVersion: resolved.version, status: "open" });
    const t = await getTicket(req, r.id);
    expect(t.status).toBe("open");
    expect(t.reopenCount).toBe(1);
    expect(t.resolvedAt).toBeNull();
    expect(t.resolutionNote).toBeNull();
    expect(t.events.some((e) => e.kind === "reopened")).toBe(true);
  });

  it("technicians must give resolution details", async () => {
    const r = await createTicket(await principal(U.contosoRequester), input(), randomUUID());
    const tech = await principal(U.tech);
    await expectAppError(updateTicket(tech, r.id, { expectedVersion: 1, status: "resolved" }), 422);
    await expectAppError(updateTicket(tech, r.id, { expectedVersion: 1, status: "resolved", resolution: "fixed" }), 422);
    await updateTicket(tech, r.id, { expectedVersion: 1, status: "resolved", resolution: "Replaced the failed power supply." });
    const t = await getTicket(await principal(U.contosoRequester), r.id);
    expect(t.status).toBe("resolved");
    expect(t.resolutionNote).toBe("Replaced the failed power supply.");
  });

  it("resolved tickets close after five days; then customers cannot reopen or reply, staff still can", async () => {
    const req = await principal(U.contosoRequester);
    const tech = await principal(U.tech);
    const r = await createTicket(req, input(), randomUUID());
    const fresh = await createTicket(req, input(), randomUUID());
    await updateTicket(tech, r.id, { expectedVersion: 1, status: "resolved", resolution: "Reset the network adapter." });
    await updateTicket(tech, fresh.id, { expectedVersion: 1, status: "resolved", resolution: "Reset the network adapter." });
    await asSystem((tx) => tx.query("update tickets set resolved_at = now() - interval '6 days' where id = $1", [r.id]));
    await asSystem((tx) => tx.query("update tickets set resolved_at = now() - interval '4 days' where id = $1", [fresh.id]));
    await autoCloseResolved();
    expect((await getTicket(req, fresh.id)).status).toBe("resolved");
    const closed = await getTicket(req, r.id);
    expect(closed.status).toBe("closed");
    expect(closed.viewer.canReply).toBe(false);
    expect(closed.viewer.canChangeStatus).toEqual([]);
    expect(closed.events.some((e) => e.kind === "closed")).toBe(true);
    await expectAppError(updateTicket(req, r.id, { expectedVersion: closed.version, status: "open" }), 409, "ticket_closed");
    await expectAppError(addMessage(req, r.id, { body: "still broken" }), 409, "ticket_closed");
    await expectAppError(updateTicket(await principal(U.contosoAdmin), r.id, { expectedVersion: closed.version, status: "open" }), 409, "ticket_closed");
    // Technicians can still add a note or reply, and can reopen a ticket closed by mistake.
    expect((await addMessage(tech, r.id, { body: "Following up internally", visibility: "internal" })).status).toBe("closed");
    const v = (await getTicket(tech, r.id)).version;
    const re = await updateTicket(tech, r.id, { expectedVersion: v, status: "open" });
    expect(re.status).toBe("open");
  });

  it("requesters cannot set arbitrary statuses", async () => {
    const req = await principal(U.contosoRequester);
    const r = await createTicket(req, input(), randomUUID());
    await expectAppError(updateTicket(req, r.id, { expectedVersion: 1, status: "in_progress" }), 403);
  });

  it("technicians can assign within the customer and changes are audited", async () => {
    const r = await createTicket(await principal(U.contosoRequester), input(), randomUUID());
    const tech = await principal(U.tech);
    await updateTicket(tech, r.id, { expectedVersion: 1, assigneeUserId: U.tech, priority: "urgent" });
    const t = await getTicket(tech, r.id);
    expect(t.assigneeName).toContain("Tess");
    expect(t.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["assigned", "priority_changed"]));
    const audit = await asSystem((tx) => tx.query("select action from audit_events where target_id = $1 order by id", [r.id]));
    expect(audit.rows.map((a) => a.action)).toEqual(["ticket.create", "ticket.update"]);
  });
});
