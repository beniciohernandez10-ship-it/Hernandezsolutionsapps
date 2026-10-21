import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { withUser } from "@/lib/db";
import { processJobs } from "@/lib/jobs";
import { createTicket, getTicket } from "@/lib/tickets/service";
import { listNotifications } from "@/lib/notify/service";
import { changeAction, createChange } from "@/lib/changes/service";
import {
  activeIncidentsFor,
  declareIncident,
  getIncident,
  incidentsForCustomer,
  linkIncidentTicket,
  listIncidents,
  postIncidentUpdate,
  upcomingMaintenance,
} from "@/lib/incidents/service";

const U = DEMO.users;
const C = DEMO.customers.contoso;
const F = DEMO.customers.fabrikam;
const ticket = async (as: string) =>
  createTicket(await principal(as), { title: "Email not arriving", description: "No mail since 9am", priority: "high", category: "email" }, randomUUID());

beforeAll(async () => {
  await freshDatabase();
});

describe("major incidents", () => {
  it("only service managers declare, only for their clients", async () => {
    await expectAppError(declareIncident(await principal(U.tech), { title: "Outage", severity: "major", allCustomers: false, customerIds: [C], message: "x" }), 403);
    await expectAppError(declareIncident(await principal(U.contosoAdmin), { title: "Outage", severity: "major", allCustomers: true, message: "x" }), 403);
    await expectAppError(declareIncident(await principal(U.manager), { title: "Outage", severity: "major", allCustomers: false, customerIds: [], message: "x" }), 422);
  });

  it("is visible only to affected customers; updates reach linked requests and client admins", async () => {
    const mgr = await principal(U.manager);
    const inc = await declareIncident(mgr, { title: "Email delivery delays", severity: "major", allCustomers: false, customerIds: [C], message: "We're investigating delayed email." });
    expect((await activeIncidentsFor(await principal(U.contosoRequester))).map((i) => i.id)).toContain(inc.id);
    expect((await activeIncidentsFor(await principal(U.fabrikamRequester))).map((i) => i.id)).not.toContain(inc.id);
    await expectAppError(getIncident(await principal(U.fabrikamAdmin), inc.id), 404);
    const direct = await withUser(U.fabrikamRequester, (tx) => tx.query("select id from service_incidents where id = $1", [inc.id]));
    expect(direct.rows).toHaveLength(0);

    const t1 = await ticket(U.contosoRequester);
    const tf = await ticket(U.fabrikamRequester);
    const tech = await principal(U.tech);
    expect((await incidentsForCustomer(tech, C)).map((i) => i.id)).toContain(inc.id);
    await linkIncidentTicket(tech, inc.id, { ticketId: t1.id });
    await expectAppError(linkIncidentTicket(await principal(U.techFabrikam), inc.id, { ticketId: tf.id }), 422);
    await expectAppError(linkIncidentTicket(await principal(U.contosoRequester), inc.id, { ticketId: t1.id }), 403);
    expect((await getTicket(await principal(U.contosoRequester), t1.id)).incident?.id).toBe(inc.id);

    await postIncidentUpdate(mgr, inc.id, { status: "identified", body: "A mail filter rule is delaying messages." });
    const seen = await getTicket(await principal(U.contosoRequester), t1.id);
    expect(seen.messages.at(-1)?.body).toContain("A mail filter rule");
    await processJobs({ limit: 100 });
    const adminNotes = await listNotifications(await principal(U.contosoAdmin));
    expect(adminNotes.some((n) => n.ref === `INC-${inc.number}` && n.href === `/portal/incidents/${inc.id}`)).toBe(true);
    expect((await listNotifications(await principal(U.fabrikamAdmin))).some((n) => n.ref === `INC-${inc.number}`)).toBe(false);
    expect((await listNotifications(await principal(U.contosoRequester))).some((n) => n.ticketId === t1.id && n.kind === "public_reply")).toBe(true);

    await postIncidentUpdate(mgr, inc.id, { status: "resolved", body: "Removed the faulty rule; mail is flowing.", resolveTickets: true });
    const done = await getTicket(await principal(U.contosoRequester), t1.id);
    expect(done.status).toBe("resolved");
    expect(done.resolutionNote).toContain(`INC-${inc.number}`);
    const lists = await listIncidents(await principal(U.contosoRequester));
    expect(lists.active.some((i) => i.id === inc.id)).toBe(false);
    expect(lists.recent.some((i) => i.id === inc.id)).toBe(true);
    await expectAppError(postIncidentUpdate(mgr, inc.id, { status: "monitoring", body: "x" }), 409);
  });

  it("all-customer incidents reach everyone", async () => {
    const inc = await declareIncident(await principal(U.manager), { title: "Microsoft 365 outage", severity: "critical", allCustomers: true, message: "Microsoft is investigating." });
    expect((await activeIncidentsFor(await principal(U.fabrikamRequester))).map((i) => i.id)).toContain(inc.id);
    expect((await getIncident(await principal(U.contosoRequester), inc.id)).canManage).toBe(false);
  });
});

describe("maintenance on the status page", () => {
  it("shows scheduled changes to every member, without the plans", async () => {
    const tech = await principal(U.tech);
    const start = new Date(Date.now() + 2 * 86400_000);
    const ch = await createChange(tech, {
      customerId: C, title: "Firewall firmware update", description: "Monthly firmware", changeType: "standard", risk: "low",
      impact: "Internet drops for 5 minutes", implementationPlan: "Update", backoutPlan: "Roll back",
      plannedStart: start.toISOString(), plannedEnd: new Date(start.getTime() + 3600_000).toISOString(), notifyCustomer: true, implementerUserId: null,
    });
    await changeAction(tech, ch.id, { action: "submit" });
    const m = await upcomingMaintenance(await principal(U.contosoRequester));
    const item = m.find((x) => x.id === ch.id)!;
    expect(item.impact).toBe("Internet drops for 5 minutes");
    expect(Object.keys(item)).not.toContain("implementationPlan");
    expect((await upcomingMaintenance(await principal(U.fabrikamRequester))).some((x) => x.id === ch.id)).toBe(false);
    void F;
  });
});
