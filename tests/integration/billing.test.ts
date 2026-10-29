import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { createTicket } from "@/lib/tickets/service";
import {
  billingCsv,
  billingDetail,
  billingOverview,
  currentMonthPacific,
  deleteTimeEntry,
  finalizeMonth,
  logTime,
  planUsage,
  reopenMonth,
  saveContract,
  ticketTime,
  timesheet,
  todayPacific,
  updateTimeEntry,
} from "@/lib/billing/service";

const U = DEMO.users;
const C = DEMO.customers.contoso;
const F = DEMO.customers.fabrikam;

/** A date in last month (always finished, always within a year). */
const lastMonth = (() => {
  const [y, m] = currentMonthPacific().split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 10));
  return { month: d.toISOString().slice(0, 7), day: (n: number) => `${d.toISOString().slice(0, 7)}-${String(n).padStart(2, "0")}` };
})();

let ticketId: string;

beforeAll(async () => {
  await freshDatabase();
  ticketId = (await createTicket(await principal(U.contosoRequester), { title: "Outlook keeps crashing", description: "Since the update", priority: "normal", category: "software" }, randomUUID())).id;
});

describe("logging time", () => {
  it("technicians for the client log time on a ticket; nobody else can", async () => {
    const tech = await principal(U.tech);
    await logTime(tech, { ticketId, workDate: todayPacific(), minutes: "1h 30m", note: "Repaired Office" });
    await logTime(tech, { ticketId, workDate: todayPacific(), minutes: 20, billable: false, note: "Follow-up call" });
    const t = await ticketTime(tech, ticketId);
    expect(t).toMatchObject({ totalMinutes: 110, billableMinutes: 90 });
    expect(t.entries[0]).toMatchObject({ userName: tech.displayName, canEdit: true });

    await expectAppError(logTime(await principal(U.contosoRequester), { ticketId, workDate: todayPacific(), minutes: 30 }), 403);
    await expectAppError(logTime(await principal(U.techFabrikam), { ticketId, workDate: todayPacific(), minutes: 30 }), 404);
    await expectAppError(ticketTime(await principal(U.contosoAdmin), ticketId), 404);
    await expectAppError(logTime(tech, { ticketId, workDate: "2999-01-01", minutes: 30 }), 422);
    await expectAppError(logTime(tech, { ticketId, workDate: todayPacific(), minutes: "forever" }), 422);
  });

  it("logs general work for a client without a ticket", async () => {
    const tech = await principal(U.tech);
    await logTime(tech, { customerId: C, workDate: todayPacific(), minutes: "45m", note: "Monthly patch review" });
    await expectAppError(logTime(tech, { customerId: F, workDate: todayPacific(), minutes: 30 }), 403);
  });

  it("only the author (or a service manager) changes an entry", async () => {
    const tech = await principal(U.tech);
    const { id } = await logTime(tech, { ticketId, workDate: todayPacific(), minutes: 15 });
    await updateTimeEntry(tech, id, { minutes: "30m", note: "Updated" });
    // Another technician for the same client: not theirs.
    const manager = await principal(U.manager);
    await updateTimeEntry(manager, id, { billable: false });
    const e = (await ticketTime(tech, ticketId)).entries.find((x) => x.id === id)!;
    expect(e).toMatchObject({ minutes: 30, note: "Updated", billable: false });
    await expectAppError(updateTimeEntry(await principal(U.techFabrikam), id, { minutes: 10 }), 404);
    await deleteTimeEntry(manager, id);
    expect((await ticketTime(tech, ticketId)).entries.some((x) => x.id === id)).toBe(false);
  });

  it("weekly timesheet: your own, and managers can view their technicians", async () => {
    const tech = await principal(U.tech);
    const week = await timesheet(tech);
    expect(week.totalMinutes).toBeGreaterThanOrEqual(155);
    expect(week.entries.every((e) => e.userId === U.tech)).toBe(true);
    const viewed = await timesheet(await principal(U.manager), { userId: U.tech });
    expect(viewed.entries.length).toBe(week.entries.length);
    await expectAppError(timesheet(tech, { userId: U.manager }), 403);
    await expectAppError(timesheet(await principal(U.contosoRequester)), 403);
  });
});

describe("billing", () => {
  it("applies the client's plan with rounding and exports safe CSV", async () => {
    const op = await principal(U.operator);
    await expectAppError(saveContract(await principal(U.manager), C, { name: "x", kind: "hourly", hourlyRate: 100, startsOn: "2026-01-01" }), 403);
    await saveContract(op, C, {
      name: "Essentials", kind: "retainer", monthlyFee: "1,500", includedHours: 1, hourlyRate: "125", roundingMinutes: 15, startsOn: "2025-01-01",
    });
    const tech = await principal(U.tech);
    // Last month: 50→60 + 25→30 = 90 billable, 60 included → 30 over at $125/h = $62.50.
    await logTime(tech, { ticketId, workDate: lastMonth.day(3), minutes: 50 });
    // General work: the note is the whole description cell, so a formula there must be neutralised.
    await logTime(tech, { customerId: C, workDate: lastMonth.day(4), minutes: 25, note: "=HYPERLINK(\"http://evil\")" });
    const d = await billingDetail(op, C, lastMonth.month);
    expect(d.totals).toMatchObject({ billableMinutes: 90, overageMinutes: 30, feeCents: 150000, overageCents: 6250, totalCents: 156250 });
    const { csv } = await billingCsv(op, C, lastMonth.month);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("Total (USD),1562.50");
    expect((await billingOverview(op, lastMonth.month)).find((r) => r.customerId === C)?.totals.totalCents).toBe(156250);
  });

  it("finalizing locks the month; reopening unlocks it", async () => {
    const op = await principal(U.operator);
    const tech = await principal(U.tech);
    await expectAppError(finalizeMonth(op, C, currentMonthPacific()), 422);
    const r = await finalizeMonth(op, C, lastMonth.month);
    expect(r.entries).toBe(2);
    const entry = (await ticketTime(tech, ticketId)).entries.find((e) => e.workDate === lastMonth.day(3))!;
    expect(entry).toMatchObject({ billed: true, canEdit: false });
    await expectAppError(updateTimeEntry(tech, entry.id, { minutes: 5 }), 409);
    await expectAppError(deleteTimeEntry(await principal(U.manager), entry.id), 409);
    await expectAppError(logTime(tech, { ticketId, workDate: lastMonth.day(5), minutes: 30 }), 409);
    await expectAppError(finalizeMonth(op, C, lastMonth.month), 409);
    // The invoiced numbers stay put even if the plan changes later.
    await saveContract(op, C, { name: "Hourly", kind: "hourly", hourlyRate: 200, startsOn: "2025-01-01" });
    expect((await billingDetail(op, C, lastMonth.month)).totals.totalCents).toBe(156250);

    await reopenMonth(op, C, lastMonth.month);
    await updateTimeEntry(tech, entry.id, { minutes: 45 });
    expect((await billingDetail(op, C, lastMonth.month)).finalized).toBeNull();
  });

  it("block hours carry across months", async () => {
    const op = await principal(U.operator);
    await saveContract(op, F, { name: "20-hour block", kind: "block", includedHours: 2, hourlyRate: 150, roundingMinutes: 1, startsOn: lastMonth.day(1) });
    const techF = await principal(U.techFabrikam);
    await logTime(techF, { customerId: F, workDate: lastMonth.day(8), minutes: 100 });
    await logTime(techF, { customerId: F, workDate: todayPacific(), minutes: 50 });
    const now = await billingDetail(op, F, currentMonthPacific());
    // 120 min block − 100 used last month = 20 left; 50 used now → 30 over.
    expect(now.totals).toMatchObject({ includedAvailableMinutes: 20, overageMinutes: 30, blockBalanceAfterMinutes: -30, totalCents: 7500 });
  });

  it("client admins see hours used, not notes or money; requesters see nothing", async () => {
    const usage = await planUsage(await principal(U.contosoAdmin), C);
    expect(usage).toMatchObject({ planName: "Hourly", kind: "hourly", includedMinutes: null });
    expect(Object.keys(usage!)).not.toContain("totalCents");
    await expectAppError(planUsage(await principal(U.contosoRequester), C), 403);
    await expectAppError(planUsage(await principal(U.contosoAdmin), F), 403);
  });
});
