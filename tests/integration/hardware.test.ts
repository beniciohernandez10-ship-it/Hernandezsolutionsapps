import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem } from "@/lib/db";
import { processJobs } from "@/lib/jobs";
import { createTicket, getTicket, listTickets } from "@/lib/tickets/service";
import { listNotifications } from "@/lib/notify/service";
import { decideApproval, listCatalog, pendingApprovals, saveCatalogItem, submitRequest } from "@/lib/catalog/service";
import { addApprover, listApproverSetup, removeApprover } from "@/lib/catalog/approvers";
import { getHardwareSettings, markDelivered, markOrdered, receiveHardware, saveHardwareSettings } from "@/lib/hardware/service";
import { getAsset } from "@/lib/assets/service";

const U = DEMO.users;
const C = DEMO.customers.contoso;

let hardwareItem: string;
let procurement: string;
let technicians: string;

async function requestHardware(as: string = U.contosoRequester, item = "Laptop") {
  return submitRequest(await principal(as), hardwareItem, { answers: { item, for_whom: "Me", details: "The old one stopped charging" } }, randomUUID());
}
const ticket = async (id: string, as: string = U.manager) => getTicket(await principal(as), id);

beforeAll(async () => {
  await freshDatabase();
  hardwareItem = (await listCatalog(await principal(U.contosoRequester))).find((i) => i.name === "New hardware")!.id;
  const q = await asSystem((tx) => tx.query<{ id: string; name: string }>("select id, name from queues"));
  procurement = q.rows.find((r) => r.name === "Procurement")!.id;
  technicians = q.rows.find((r) => r.name === "Technicians")!.id;
});

describe("named approvers", () => {
  it("only the named approver (or a service manager) decides, and they can see what they're approving", async () => {
    const op = await principal(U.operator);
    await addApprover(op, { customerId: C, userId: U.contosoRequester2 });
    expect((await listApproverSetup(op)).find((c) => c.customerId === C)!.approvers.map((a) => a.userId)).toEqual([U.contosoRequester2]);

    const t = await requestHardware();
    const approver = await principal(U.contosoRequester2);
    expect(approver.approverFor).toEqual([C]);
    const seen = await getTicket(approver, t.id);
    expect(seen.approval).toMatchObject({ status: "pending", canDecide: true, approverLabel: "Rowan Reed (Demo)" });
    expect(seen.hardware?.stage).toBe("approval");
    expect((await listTickets(approver, {})).items.some((x) => x.id === t.id)).toBe(true);
    expect((await pendingApprovals(approver)).some((x) => x.ticketId === t.id)).toBe(true);
    // The client admin no longer decides once someone is named.
    expect((await ticket(t.id, U.contosoAdmin)).approval?.canDecide).toBe(false);
    await expectAppError(decideApproval(await principal(U.contosoAdmin), t.id, { decision: "approved" }), 403);

    // Approvers see requests that go through approval, not everyone's tickets.
    const other = await createTicket(await principal(U.contosoRequester), { title: "Printer jam", description: "Paper stuck", priority: "normal", category: "hardware" }, randomUUID());
    await expectAppError(getTicket(approver, other.id), 404);
    expect((await listTickets(approver, {})).items.some((x) => x.id === other.id)).toBe(false);

    await processJobs({ limit: 50 });
    expect((await listNotifications(approver)).some((n) => n.ticketId === t.id && n.kind === "approval_requested")).toBe(true);
    expect((await listNotifications(await principal(U.contosoAdmin))).some((n) => n.ticketId === t.id && n.kind === "approval_requested")).toBe(false);

    await decideApproval(approver, t.id, { decision: "approved" });
    const after = await ticket(t.id);
    expect(after).toMatchObject({ approvalStatus: "approved", queueId: procurement, assigneeUserId: null });
    expect(after.hardware?.stage).toBe("ordering");
  });

  it("falls back to client admins when nobody is named; rejection cancels the order", async () => {
    const op = await principal(U.operator);
    await removeApprover(op, { customerId: C, userId: U.contosoRequester2 });
    const t = await requestHardware();
    await expectAppError(getTicket(await principal(U.contosoRequester2), t.id), 404);
    await decideApproval(await principal(U.contosoAdmin), t.id, { decision: "rejected", note: "Use the spare in the cupboard" });
    const after = await ticket(t.id);
    expect(after.hardware?.stage).toBe("cancelled");
    expect(after.status).toBe("resolved");
    expect(after.queueId).not.toBe(procurement);
    await expectAppError(addApprover(op, { customerId: C, userId: U.fabrikamRequester }), 422);
    await expectAppError(addApprover(await principal(U.manager), { customerId: C, userId: U.contosoRequester2 }), 403);
  });

  it("an ordinary request that needs approval isn't sent to Procurement", async () => {
    const { id } = await saveCatalogItem(await principal(U.operator), null, {
      customerId: null, name: "Shared mailbox", summary: "", category: "email", defaultPriority: "normal",
      fields: [{ key: "name", label: "Mailbox name", type: "text", required: true }], tasks: [], requiresApproval: true, workflow: "standard", active: true, sortOrder: 50,
    });
    const t = await submitRequest(await principal(U.contosoRequester), id, { answers: { name: "billing@" } }, randomUUID());
    await decideApproval(await principal(U.contosoAdmin), t.id, { decision: "approved" });
    const after = await ticket(t.id);
    expect(after.queueId).not.toBe(procurement);
    expect(after.hardware).toBeNull();
  });
});

describe("ordering, receiving and delivery", () => {
  it("records the order, registers scanned items as the requester's assets, routes to technicians and resolves on delivery", async () => {
    const t = await requestHardware();
    await decideApproval(await principal(U.contosoAdmin), t.id, { decision: "approved" });
    const tech = await principal(U.tech);
    const requester = await principal(U.contosoRequester);

    await expectAppError(markOrdered(requester, t.id, { vendor: "CDW" }), 403);
    await expectAppError(receiveHardware(tech, t.id, { items: [{ kind: "laptop", serialNumber: "5CG4321XYZ" }], deliveryMethod: "user_setup" }), 422);
    await markOrdered(tech, t.id, { vendor: "CDW", orderRef: "PO-1042", expectedOn: "2026-11-02" });
    let mine = await getTicket(requester, t.id);
    expect(mine.hardware).toMatchObject({ stage: "ordered", expectedOn: "2026-11-02", vendor: null, orderRef: null });
    expect(mine.status).toBe("in_progress");
    expect(mine.messages.at(-1)?.body).toContain("has been ordered");
    expect((await ticket(t.id)).hardware).toMatchObject({ vendor: "CDW", orderRef: "PO-1042" });

    const r = await receiveHardware(tech, t.id, {
      items: [{ kind: "laptop", serialNumber: "5CG4321XYZ", manufacturer: "Dell", model: "Latitude 7450" }],
      deliveryMethod: "tech_setup",
    });
    expect(r.tags[0]).toMatch(/^LAPTOP-\d{3}$/);
    const staffView = await ticket(t.id);
    expect(staffView).toMatchObject({ queueId: technicians, assigneeUserId: null });
    expect(staffView.hardware).toMatchObject({ stage: "received", deliveryMethod: "tech_setup" });
    expect(staffView.hardware!.items[0].label).toBe(`${r.tags[0]} · Dell Latitude 7450 · SN 5CG4321XYZ`);
    mine = await getTicket(requester, t.id);
    expect(mine.hardware!.items).toEqual([{ label: staffView.hardware!.items[0].label, assetId: null }]);
    expect(mine.messages.at(-1)?.body).toContain("set it up");

    const asset = await getAsset(await principal(U.contosoAdmin), staffView.hardware!.items[0].assetId!);
    expect(asset).toMatchObject({ tag: r.tags[0], serialNumber: "5CG4321XYZ", model: "Latitude 7450", primaryUserName: requester.displayName });

    // The same serial can't be registered twice.
    const again = await requestHardware();
    await decideApproval(await principal(U.contosoAdmin), again.id, { decision: "approved" });
    await expectAppError(receiveHardware(tech, again.id, { items: [{ kind: "laptop", serialNumber: "5cg4321xyz" }], deliveryMethod: "tech_setup" }), 409);

    await expectAppError(markOrdered(tech, t.id, {}), 409);
    await markDelivered(tech, t.id, { note: "Migrated files from the old laptop." });
    const done = await ticket(t.id);
    expect(done.status).toBe("resolved");
    expect(done.hardware?.stage).toBe("delivered");
    expect(done.resolutionNote).toContain(`Delivered and set up by ${tech.displayName}: ${r.tags[0]}`);
    expect(done.resolutionNote).toContain("Migrated files");
    await expectAppError(markDelivered(tech, t.id, {}), 409);
  });

  it("other hardware gets its own tags and can go to the user to set up; items can be received without marking ordered", async () => {
    const t = await requestHardware(U.contosoRequester, "Monitor");
    await decideApproval(await principal(U.contosoAdmin), t.id, { decision: "approved" });
    const tech = await principal(U.tech);
    const r = await receiveHardware(tech, t.id, {
      items: [
        { kind: "monitor", serialNumber: "CN-0ABC123" },
        { kind: "dock", serialNumber: "DK-778899", manufacturer: "Dell", model: "WD19S" },
      ],
      deliveryMethod: "user_setup",
    });
    expect(r.tags[0]).toMatch(/^MON-\d{3}$/);
    expect(r.tags[1]).toMatch(/^DOCK-\d{3}$/);
    await markDelivered(tech, t.id, {});
    expect((await ticket(t.id)).resolutionNote).toContain("Delivered for the user to set up");
  });

  it("operators choose the ordering and delivery queues", async () => {
    const op = await principal(U.operator);
    expect(await getHardwareSettings(op)).toEqual({ orderQueueId: procurement, deliveryQueueId: technicians });
    await saveHardwareSettings(op, { orderQueueId: technicians, deliveryQueueId: technicians });
    const t = await requestHardware();
    await decideApproval(await principal(U.contosoAdmin), t.id, { decision: "approved" });
    expect((await ticket(t.id)).queueId).toBe(technicians);
    await saveHardwareSettings(op, { orderQueueId: procurement, deliveryQueueId: technicians });
    await expectAppError(saveHardwareSettings(await principal(U.manager), { orderQueueId: null, deliveryQueueId: null }), 403);
  });
});
