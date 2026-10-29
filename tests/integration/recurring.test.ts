import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem } from "@/lib/db";
import { getTicket, updateTicket } from "@/lib/tickets/service";
import { deleteRecurring, listRecurring, runDueRecurring, runRecurringNow, saveRecurring } from "@/lib/recurring/service";

const U = DEMO.users;
const C = DEMO.customers.contoso;
const F = DEMO.customers.fabrikam;

// Noon UTC is the same calendar day in Pacific time.
const at = (day: string) => new Date(`${day}T20:00:00Z`);

const base = {
  customerId: C,
  title: "Patch review – {month}",
  description: "Review last month's updates for {month}.",
  priority: "normal",
  category: "software",
  frequency: "monthly",
  interval: 1,
  startsOn: "2026-11-15",
  tasks: ["Check failed updates", "Reboot servers for {month}"],
};

const ticketsFrom = async (id: string) =>
  (
    await asSystem((tx) =>
      tx.query<{ id: string; title: string }>(
        `select t.id, t.title from audit_events a join tickets t on t.id = (a.details->>'ticketId')::uuid
          where a.target_id = $1::text and a.action in ('recurring.ticket', 'recurring.run_now') order by t.number`,
        [id],
      ),
    )
  ).rows;

beforeAll(async () => {
  await freshDatabase();
});

describe("recurring requests", () => {
  it("opens one request per date, with the checklist, then moves to the next date", async () => {
    const op = await principal(U.operator);
    const { id, nextRunOn } = await saveRecurring(op, null, { ...base, assigneeUserId: U.tech }, at("2026-11-01"));
    expect(nextRunOn).toBe("2026-11-15");

    // Not yet due.
    await runDueRecurring(at("2026-11-14"));
    expect(await ticketsFrom(id)).toHaveLength(0);

    await runDueRecurring(at("2026-11-15"));
    await runDueRecurring(at("2026-11-15"));
    const [first] = await ticketsFrom(id);
    expect(await ticketsFrom(id)).toHaveLength(1);
    const t = await getTicket(await principal(U.tech), first.id);
    expect(t).toMatchObject({ title: "Patch review – November 2026", requesterName: "IT Center Scheduler", assigneeUserId: U.tech, kind: "request", category: "software" });
    expect(t.description).toContain("Review last month's updates for November 2026.");
    expect(t.tasks.map((x) => x.title)).toEqual(["Check failed updates", "Reboot servers for November 2026"]);

    const [row] = (await listRecurring(op)).filter((r) => r.id === id);
    expect(row).toMatchObject({ nextRunOn: "2026-12-15", lastRunOn: "2026-11-15", lastOutcome: "created", lastTicket: { id: first.id } });
  });

  it("skips a date while the last request is open, and jumps past missed dates", async () => {
    const op = await principal(U.operator);
    const { id } = await saveRecurring(op, null, { ...base, title: "Backup test", startsOn: "2026-11-01", frequency: "weekly" }, at("2026-11-01"));
    await runDueRecurring(at("2026-11-01"));
    const [first] = await ticketsFrom(id);

    // A week later the first one is still open: skipped.
    await runDueRecurring(at("2026-11-08"));
    expect(await ticketsFrom(id)).toHaveLength(1);
    expect((await listRecurring(op)).find((r) => r.id === id)).toMatchObject({ lastOutcome: "skipped_open", nextRunOn: "2026-11-15" });

    // Resolved, then nobody ran it for three weeks: one request, next date after today.
    const tech = await principal(U.tech);
    const t = await getTicket(tech, first.id);
    await updateTicket(tech, t.id, { expectedVersion: t.version, status: "resolved", resolution: "Restored a test file." });
    await runDueRecurring(at("2026-12-03"));
    expect(await ticketsFrom(id)).toHaveLength(2);
    expect((await listRecurring(op)).find((r) => r.id === id)?.nextRunOn).toBe("2026-12-06");
  });

  it("uses a named requester while they're a member, and stops after the end date", async () => {
    const op = await principal(U.operator);
    const { id } = await saveRecurring(
      op,
      null,
      { ...base, title: "Quarterly access review", frequency: "quarterly", startsOn: "2026-12-01", endsOn: "2027-04-01", requesterUserId: U.contosoAdmin, skipIfOpen: false },
      at("2026-11-20"),
    );
    await runDueRecurring(at("2026-12-01"));
    const [t1] = await ticketsFrom(id);
    expect((await getTicket(await principal(U.contosoAdmin), t1.id)).requesterName).not.toBe("IT Center Scheduler");
    await runDueRecurring(at("2027-03-01"));
    expect(await ticketsFrom(id)).toHaveLength(2);
    // June 1 is after the end date.
    expect((await listRecurring(op)).find((r) => r.id === id)?.nextRunOn).toBeNull();
    await runDueRecurring(at("2027-06-01"));
    expect(await ticketsFrom(id)).toHaveLength(2);
  });

  it("opening one now doesn't move the schedule; pausing stops it", async () => {
    const mgr = await principal(U.manager);
    const { id } = await saveRecurring(mgr, null, { ...base, title: "Printer toner check", startsOn: "2027-01-05" }, at("2026-11-01"));
    const now = await runRecurringNow(mgr, id, at("2026-11-02"));
    expect(now.number).toBeGreaterThan(0);
    const row = (await listRecurring(mgr)).find((r) => r.id === id)!;
    expect(row.nextRunOn).toBe("2027-01-05");

    await saveRecurring(mgr, id, { ...base, title: "Printer toner check", startsOn: "2027-01-05", active: false }, at("2026-11-02"));
    await runDueRecurring(at("2027-01-05"));
    expect(await ticketsFrom(id)).toHaveLength(1);
    await deleteRecurring(mgr, id);
    expect((await listRecurring(mgr)).find((r) => r.id === id)).toBeUndefined();
  });

  it("only operators and the client's service managers change schedules; technicians only see their clients'", async () => {
    const op = await principal(U.operator);
    await expectAppError(saveRecurring(await principal(U.tech), null, base), 403);
    await expectAppError(saveRecurring(await principal(U.contosoAdmin), null, base), 403);
    await expectAppError(listRecurring(await principal(U.contosoAdmin)), 403);
    // People must belong to the client.
    await expectAppError(saveRecurring(op, null, { ...base, assigneeUserId: U.techFabrikam }), 422);
    await expectAppError(saveRecurring(op, null, { ...base, requesterUserId: U.fabrikamRequester }), 422);
    await expectAppError(saveRecurring(op, null, { ...base, startsOn: "2026-02-30" }), 422);

    await saveRecurring(op, null, { ...base, customerId: F, title: "Fabrikam firewall review" });
    expect((await listRecurring(await principal(U.tech))).every((r) => r.customerId === C)).toBe(true);
    expect((await listRecurring(await principal(U.techFabrikam))).map((r) => r.title)).toEqual(["Fabrikam firewall review"]);
    expect((await listRecurring(await principal(U.tech))).every((r) => !r.canManage)).toBe(true);
  });
});
