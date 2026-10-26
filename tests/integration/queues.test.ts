import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem } from "@/lib/db";
import { createTicket, getTicket, updateTicket } from "@/lib/tickets/service";
import { saveRule } from "@/lib/productivity/service";
import { bulkUpdate, deleteQueue, listQueuesAdmin, queueBoard, saveQueue } from "@/lib/queues/service";

const U = DEMO.users;
const make = async (as: string, o: object = {}) =>
  createTicket(await principal(as), { title: "Printer jammed", description: "Front desk printer", priority: "normal", category: "hardware", ...o }, randomUUID());
const version = async (id: string) => (await getTicket(await principal(U.manager), id)).version;

let serviceDesk: string;
let projects: string;

beforeAll(async () => {
  await freshDatabase();
  const q = await asSystem((tx) => tx.query<{ id: string; name: string }>("select id, name from queues"));
  serviceDesk = q.rows.find((r) => r.name === "Service desk")!.id;
  projects = q.rows.find((r) => r.name === "Projects")!.id;
});

describe("queue board", () => {
  it("shows only the clients a technician supports, most urgent first", async () => {
    const low = await make(U.contosoRequester, { title: "Low one", priority: "low" });
    const urgent = await make(U.contosoRequester, { title: "Urgent one", priority: "urgent" });
    const other = await make(U.fabrikamRequester, { title: "Fabrikam one" });
    const tech = await principal(U.tech);
    const board = await queueBoard(tech, { queue: "none" });
    const ids = board.items.map((t) => t.id);
    expect(ids).toContain(low.id);
    expect(ids).not.toContain(other.id);
    expect(ids.indexOf(urgent.id)).toBeLessThan(ids.indexOf(low.id));
    expect(board.none.active).toBe(board.items.length);
    // The manager supports both clients.
    expect((await queueBoard(await principal(U.manager), { queue: "none" })).items.map((t) => t.id)).toContain(other.id);
  });

  it("falls back to every queue for an unknown queue, and refuses non-staff", async () => {
    const board = await queueBoard(await principal(U.tech), { queue: randomUUID() });
    expect(board.queue).toBe("all");
    await expectAppError(queueBoard(await principal(U.contosoAdmin)), 403);
    await expectAppError(queueBoard(await principal(U.operator)), 403);
  });
});

describe("bulk changes", () => {
  it("assigns to me and moves between queues, counting per queue", async () => {
    const a = await make(U.contosoRequester);
    const b = await make(U.contosoRequester);
    const tech = await principal(U.tech);
    const sel = async (...ids: string[]) => Promise.all(ids.map(async (id) => ({ id, version: await version(id) })));

    expect(await bulkUpdate(tech, { action: "move", queueId: serviceDesk, tickets: await sel(a.id, b.id) })).toEqual({ updated: 2, failed: [] });
    expect(await bulkUpdate(tech, { action: "take", tickets: await sel(a.id) })).toEqual({ updated: 1, failed: [] });

    const board = await queueBoard(tech, { queue: serviceDesk });
    expect(board.items.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    const desk = board.queues.find((q) => q.id === serviceDesk)!;
    expect(desk.mine).toBeGreaterThanOrEqual(1);
    expect(desk.unassigned).toBeGreaterThanOrEqual(1);
    expect((await queueBoard(tech, { queue: serviceDesk, assigned: "me" })).items.map((t) => t.id)).toEqual([a.id]);
    // History and assignment are recorded the same way as a single change.
    const detail = await getTicket(tech, a.id);
    expect(detail.assigneeUserId).toBe(U.tech);
    expect(detail.events.some((e) => e.kind === "assigned")).toBe(true);
  });

  it("keeps going when one request fails, and says which", async () => {
    const fresh = await make(U.contosoRequester);
    const stale = await make(U.contosoRequester);
    const fab = await make(U.fabrikamRequester);
    const manager = await principal(U.manager);
    const staleVersion = await version(stale.id);
    await updateTicket(manager, stale.id, { expectedVersion: staleVersion, priority: "high" });
    const r = await bulkUpdate(manager, {
      action: "assign",
      assigneeUserId: U.tech, // supports Contoso only
      tickets: [
        { id: fresh.id, version: await version(fresh.id) },
        { id: stale.id, version: staleVersion },
        { id: fab.id, version: await version(fab.id) },
      ],
    });
    expect(r.updated).toBe(1);
    expect(r.failed.map((f) => f.id).sort()).toEqual([stale.id, fab.id].sort());
    expect(r.failed.find((f) => f.id === stale.id)!.message).toMatch(/someone else updated/i);
    expect((await getTicket(manager, fab.id)).assigneeUserId).toBeNull();
  });

  it("can't touch other clients' requests or a queue that doesn't exist", async () => {
    const fab = await make(U.fabrikamRequester);
    const tech = await principal(U.tech);
    const r = await bulkUpdate(tech, { action: "take", tickets: [{ id: fab.id, version: 1 }] });
    expect(r.updated).toBe(0);
    await expectAppError(bulkUpdate(tech, { action: "move", queueId: randomUUID(), tickets: [{ id: fab.id, version: 1 }] }), 422);
    await expectAppError(bulkUpdate(await principal(U.contosoAdmin), { action: "take", tickets: [{ id: fab.id, version: 1 }] }), 403);
    await expectAppError(bulkUpdate(tech, { action: "assign", tickets: [{ id: fab.id, version: 1 }] }), 422);
  });
});

describe("managing queues", () => {
  it("lets operators add and rename queues, with unique names", async () => {
    const op = await principal(U.operator);
    const { id } = await saveQueue(op, null, { name: "  Onboarding  " });
    await saveQueue(op, id, { name: "New starters" });
    expect((await listQueuesAdmin(op)).find((q) => q.id === id)?.name).toBe("New starters");
    await expectAppError(saveQueue(op, null, { name: "Projects" }), 409);
    await expectAppError(saveQueue(op, null, { name: "projects" }), 409);
    await saveQueue(op, id, { name: "new Starters" }); // renaming a queue's own case is fine
    await expectAppError(saveQueue(op, null, { name: "x" }), 422);
    await expectAppError(saveQueue(await principal(U.manager), null, { name: "Mine" }), 403);
  });

  it("deleting a queue moves its requests and rules, and bumps versions", async () => {
    const op = await principal(U.operator);
    const { id: temp } = await saveQueue(op, null, { name: "Temporary" });
    const t = await make(U.contosoRequester);
    const tech = await principal(U.tech);
    await bulkUpdate(tech, { action: "move", queueId: temp, tickets: [{ id: t.id, version: await version(t.id) }] });
    const before = await version(t.id);
    await saveRule(op, null, { name: "Route printers", customerId: null, active: true, position: 1, matchCategory: "hardware", matchPriority: null, matchKind: null, matchKeyword: null, assignUserId: null, assignQueueId: temp });

    // The rule only routes to this queue, so it needs somewhere to go.
    await expectAppError(deleteQueue(op, temp, { moveTo: null }), 422);
    await expectAppError(deleteQueue(op, temp, { moveTo: temp }), 422);
    const r = await deleteQueue(op, temp, { moveTo: projects });
    expect(r.ticketsMoved).toBe(1);
    const d = await getTicket(tech, t.id);
    expect(d.queueId).toBe(projects);
    expect(d.version).toBe(before + 1);
    const rule = await asSystem((tx) => tx.query<{ assign_queue_id: string }>("select assign_queue_id from assignment_rules where name = 'Route printers'"));
    expect(rule.rows[0].assign_queue_id).toBe(projects);
    expect((await listQueuesAdmin(op)).some((q) => q.id === temp)).toBe(false);
    await expectAppError(deleteQueue(op, temp, { moveTo: null }), 404);
  });
});
