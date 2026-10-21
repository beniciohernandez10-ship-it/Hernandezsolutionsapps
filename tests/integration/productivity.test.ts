import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { withUser } from "@/lib/db";
import { processJobs } from "@/lib/jobs";
import { addMessage, createTicket, getTicket } from "@/lib/tickets/service";
import { listNotifications } from "@/lib/notify/service";
import {
  deleteCanned,
  deleteRule,
  fillPlaceholders,
  listCanned,
  listRules,
  mergeTicket,
  saveCanned,
  saveRule,
  setParent,
} from "@/lib/productivity/service";

const U = DEMO.users;
const C = DEMO.customers.contoso;
const F = DEMO.customers.fabrikam;
const input = (o: object = {}) => ({ title: "Monitor flickers", description: "Second screen flickers", priority: "normal", category: "hardware", ...o });
const make = async (as: string = U.contosoRequester, o: object = {}) => createTicket(await principal(as), input(o), randomUUID());

beforeAll(async () => {
  await freshDatabase();
});

describe("merging duplicates", () => {
  it("resolves the duplicate, points at the target and copies its details privately", async () => {
    const target = await make();
    const dup = await make(U.contosoRequester2, { title: "Screen flickering again" });
    const tech = await principal(U.tech);
    const r = await mergeTicket(tech, dup.id, { number: target.number });
    expect(r.mergedInto).toBe(target.id);
    const d = await getTicket(tech, dup.id);
    expect(d.status).toBe("resolved");
    expect(d.resolutionNote).toBe(`Merged into #${target.number}: Monitor flickers`);
    expect(d.related.mergedInto?.id).toBe(target.id);
    const t = await getTicket(tech, target.id);
    expect(t.messages.at(-1)?.visibility).toBe("internal");
    expect(t.messages.at(-1)?.body).toContain("Screen flickering again");
    // The duplicate's requester can't see the target (not theirs), but is told it was resolved.
    const own = await getTicket(await principal(U.contosoRequester2), dup.id);
    expect(own.related.mergedInto).toBeNull();
    expect(own.resolutionNote).toContain(`#${target.number}`);
    await processJobs({ limit: 50 });
    expect((await listNotifications(await principal(U.contosoRequester2))).some((n) => n.ticketId === dup.id && n.kind === "status_changed")).toBe(true);
    await expectAppError(mergeTicket(tech, dup.id, { number: target.number }), 409);
  });

  it("refuses other customers' tickets, self-merges and non-staff", async () => {
    const a = await make();
    const b = await make(U.fabrikamRequester);
    const tech = await principal(U.tech);
    await expectAppError(mergeTicket(tech, a.id, { number: b.number }), 422);
    await expectAppError(mergeTicket(tech, a.id, { number: a.number }), 422);
    await expectAppError(mergeTicket(await principal(U.contosoAdmin), a.id, { number: a.number }), 403);
    await expectAppError(mergeTicket(await principal(U.techFabrikam), a.id, { number: b.number }), 404);
  });
});

describe("parent and child requests", () => {
  it("links within a customer and prevents loops", async () => {
    const parent = await make(U.contosoRequester, { title: "Office move" });
    const child = await make(U.contosoRequester, { title: "Move printer" });
    const grandchild = await make(U.contosoRequester, { title: "Reconnect scanner" });
    const tech = await principal(U.tech);
    await setParent(tech, child.id, { number: parent.number });
    await setParent(tech, grandchild.id, { number: child.number });
    await expectAppError(setParent(tech, parent.id, { number: grandchild.number }), 422);
    await expectAppError(setParent(tech, parent.id, { number: parent.number }), 422);
    const p = await getTicket(await principal(U.contosoRequester), parent.id);
    expect(p.related.children.map((c) => c.number)).toEqual([child.number]);
    expect((await getTicket(tech, child.id)).related.parent?.id).toBe(parent.id);
    await setParent(tech, child.id, { number: null });
    expect((await getTicket(tech, child.id)).related.parent).toBeNull();
    const other = await make(U.fabrikamRequester);
    await expectAppError(setParent(tech, child.id, { number: other.number }), 422);
    // The database refuses a cross-customer parent even if the app check were skipped.
    await expect(withUser(U.manager, (tx) => tx.query("update tickets set parent_ticket_id = $2 where id = $1", [child.id, other.id]))).rejects.toThrow();
  });
});

describe("assignment rules", () => {
  it("assigns new tickets by the first matching rule, customer rules first", async () => {
    const op = await principal(U.operator);
    const general = await saveRule(op, null, {
      name: "Email to the manager", customerId: null, active: true, position: 10, matchCategory: "email",
      matchPriority: null, matchKind: null, matchKeyword: null, assignUserId: U.manager, assignQueueId: null,
    });
    const specific = await saveRule(op, null, {
      name: "Contoso email to Tess", customerId: C, active: true, position: 50, matchCategory: "email",
      matchPriority: null, matchKind: null, matchKeyword: null, assignUserId: U.tech, assignQueueId: null,
    });
    const keyword = await saveRule(op, null, {
      name: "Fabrikam printers", customerId: F, active: true, position: 5, matchCategory: null,
      matchPriority: null, matchKind: null, matchKeyword: "printer", assignUserId: U.techFabrikam, assignQueueId: null,
    });
    const c = await make(U.contosoRequester, { category: "email", title: "Mailbox full" });
    const tc = await getTicket(await principal(U.tech), c.id);
    expect(tc.assigneeUserId).toBe(U.tech);
    expect(tc.events.some((e) => e.kind === "auto_assigned" && e.toValue === "Contoso email to Tess")).toBe(true);
    const f = await make(U.fabrikamRequester, { category: "email", title: "Outlook offline" });
    expect((await getTicket(await principal(U.manager), f.id)).assigneeUserId).toBe(U.manager);
    const fp = await make(U.fabrikamRequester, { category: "hardware", title: "Printer jam", description: "The PRINTER is jammed" });
    expect((await getTicket(await principal(U.manager), fp.id)).assigneeUserId).toBe(U.techFabrikam);
    const none = await make(U.contosoRequester, { category: "network" });
    expect((await getTicket(await principal(U.tech), none.id)).assigneeUserId).toBeNull();
    // The assignee hears about it as a new request.
    await processJobs({ limit: 50 });
    expect((await listNotifications(await principal(U.tech))).some((n) => n.ticketId === c.id && n.kind === "ticket_created")).toBe(true);
    // Rules are operator-only and invisible to customers.
    await expectAppError(listRules(await principal(U.manager)), 403);
    await expect(withUser(U.contosoRequester, (tx) => tx.query("select * from assignment_rules"))).rejects.toThrow(/permission denied/);
    await expectAppError(
      saveRule(op, null, { name: "Bad", customerId: C, active: true, position: 1, matchCategory: null, matchPriority: null, matchKind: null, matchKeyword: null, assignUserId: U.techFabrikam, assignQueueId: null }),
      422,
    );
    for (const r of [general, specific, keyword]) await deleteRule(op, r.id);
  });
});

describe("saved replies", () => {
  it("staff manage them per customer or for all; customers can't see them", async () => {
    const tech = await principal(U.tech);
    const all = await saveCanned(tech, null, { customerId: null, title: "Restart first", body: "Hi {{requester_first_name}}, please restart." });
    const contoso = await saveCanned(tech, null, { customerId: C, title: "Contoso Wi-Fi", body: "The guest network is ..." });
    await expectAppError(saveCanned(await principal(U.techFabrikam), null, { customerId: C, title: "x", body: "y" }), 403);
    await expectAppError(saveCanned(await principal(U.contosoAdmin), null, { customerId: null, title: "x", body: "y" }), 403);
    expect((await listCanned(tech, C)).map((x) => x.id)).toEqual(expect.arrayContaining([all.id, contoso.id]));
    expect((await listCanned(await principal(U.techFabrikam), F)).map((x) => x.id)).toEqual([all.id]);
    expect(await listCanned(await principal(U.contosoRequester), C)).toEqual([]);
    const direct = await withUser(U.contosoAdmin, (tx) => tx.query("select * from canned_responses"));
    expect(direct.rows).toHaveLength(0);
    expect(fillPlaceholders("Hi {{requester_first_name}}, about {{ticket_number}} — {{technician_name}}", { requesterName: "Riley Rivera", ticketNumber: 12, technicianName: "Tess" })).toBe(
      "Hi Riley, about #12 — Tess",
    );
    // Shared replies are for all technicians; client-specific ones only for that client's technicians.
    await expectAppError(deleteCanned(await principal(U.techFabrikam), contoso.id), 404);
    await deleteCanned(tech, contoso.id);
    // A saved reply is just text in a normal reply.
    const t = await make();
    await addMessage(tech, t.id, { body: fillPlaceholders(all.id ? "Hi {{requester_first_name}}" : "", { requesterName: "Riley Rivera", ticketNumber: t.number, technicianName: "Tess" }) });
  });
});
