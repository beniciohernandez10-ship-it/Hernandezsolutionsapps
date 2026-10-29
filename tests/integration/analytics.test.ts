import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem } from "@/lib/db";
import { addMessage, createTicket, getTicket, updateTicket } from "@/lib/tickets/service";
import { analytics } from "@/lib/analytics/service";

const U = DEMO.users;
const C = DEMO.customers.contoso;
const F = DEMO.customers.fabrikam;

beforeAll(async () => {
  await freshDatabase();
});

async function resolvedTicket(replies: number) {
  const riley = await principal(U.contosoRequester);
  const tech = await principal(U.tech);
  const t = await createTicket(riley, { title: "Mouse not working", description: "Left click stuck.", priority: "low", category: "hardware" }, randomUUID());
  for (let i = 0; i < replies; i++) await addMessage(tech, t.id, { body: `Step ${i + 1}: try another USB port.` });
  const cur = await getTicket(tech, t.id);
  await updateTicket(tech, t.id, { expectedVersion: cur.version, assigneeUserId: U.tech, status: "resolved", resolution: "Replaced the mouse." });
  return t.id;
}

describe("analytics", () => {
  it("counts first-contact resolution, workload and backlog for the technician's clients", async () => {
    const tech = await principal(U.tech);
    const before = await analytics(tech, { days: 30 });
    await resolvedTicket(1);
    await resolvedTicket(3);
    const after = await analytics(tech, { days: 30 });

    expect(after.firstContact.resolved - before.firstContact.resolved).toBe(2);
    expect(after.firstContact.firstContact - before.firstContact.firstContact).toBe(1);
    expect(after.totals.resolved - before.totals.resolved).toBe(2);
    const tess = after.workload.find((w) => w.userId === U.tech)!;
    expect(tess.resolved - (before.workload.find((w) => w.userId === U.tech)?.resolved ?? 0)).toBe(2);
    expect(after.unit).toBe("week");
    expect(after.trend.length).toBeGreaterThanOrEqual(5);
    expect(after.trend.reduce((s, b) => s + b.resolved, 0)).toBeGreaterThanOrEqual(2);
    expect(after.backlog.reduce((s, b) => s + b.count, 0)).toBe(after.totals.openNow);
    // Tess only supports Contoso.
    expect(after.customers.map((c) => c.id)).toEqual([C]);
  });

  it("ages the backlog, and a client filter narrows it", async () => {
    const riley = await principal(U.contosoRequester);
    const t = await createTicket(riley, { title: "Old VPN issue", description: "Still slow.", priority: "high", category: "network" }, randomUUID());
    await asSystem((tx) => tx.query("update tickets set created_at = now() - interval '40 days' where id = $1", [t.id]));
    const a = await analytics(await principal(U.manager), { days: 365, customerId: C });
    expect(a.unit).toBe("month");
    const over = a.backlog.find((b) => b.label === "Over 4 weeks")!;
    expect(over.byPriority.high).toBeGreaterThanOrEqual(1);
    expect(a.oldest.some((o) => o.id === t.id)).toBe(true);
    const fab = await analytics(await principal(U.manager), { days: 365, customerId: F });
    expect(fab.oldest.some((o) => o.id === t.id)).toBe(false);
  });

  it("is for staff, on their own clients only", async () => {
    await expectAppError(analytics(await principal(U.contosoAdmin)), 403);
    await expectAppError(analytics(await principal(U.tech), { customerId: F }), 403);
    await expectAppError(analytics(await principal(U.tech), { days: 7 }), 422);
  });
});
