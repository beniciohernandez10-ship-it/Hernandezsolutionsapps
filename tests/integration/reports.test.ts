import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem, withUser } from "@/lib/db";
import { addMessage, autoCloseResolved, createTicket, getTicket, updateTicket } from "@/lib/tickets/service";
import { submitSurvey } from "@/lib/surveys/service";
import { buildReport, csvCell, currentMonth, exportTicketsCsv, monthRange } from "@/lib/reports/service";

const U = DEMO.users;
const C = DEMO.customers.contoso;
const F = DEMO.customers.fabrikam;
const input = (o: object = {}) => ({ title: "VPN drops", description: "Disconnects hourly", priority: "high", category: "network", ...o });

beforeAll(async () => {
  await freshDatabase();
});

async function resolvedTicket(as: string = U.contosoRequester) {
  const r = await createTicket(await principal(as), input(), randomUUID());
  const tech = await principal(U.tech);
  await addMessage(tech, r.id, { body: "Looking now" });
  const v = (await getTicket(tech, r.id)).version;
  await updateTicket(tech, r.id, { expectedVersion: v, status: "resolved", resolution: "Updated the VPN client to the latest version." });
  return r;
}

describe("satisfaction surveys", () => {
  it("only the requester rates, only while resolved, and can change it until closed", async () => {
    const r = await resolvedTicket();
    const req = await principal(U.contosoRequester);
    await expectAppError(submitSurvey(await principal(U.contosoAdmin), r.id, { rating: "good" }), 403);
    await expectAppError(submitSurvey(await principal(U.contosoRequester2), r.id, { rating: "good" }), 404);
    await expectAppError(submitSurvey(await principal(U.fabrikamRequester), r.id, { rating: "good" }), 404);
    await submitSurvey(req, r.id, { rating: "bad", comment: "Took a while" });
    await submitSurvey(req, r.id, { rating: "good", comment: "Fixed in the end, thanks" });
    const staffView = await getTicket(await principal(U.tech), r.id);
    expect(staffView.survey).toMatchObject({ rating: "good", comment: "Fixed in the end, thanks" });
    expect((await getTicket(await principal(U.contosoAdmin), r.id)).survey?.rating).toBe("good");
    await asSystem((tx) => tx.query("update tickets set resolved_at = now() - interval '6 days' where id = $1", [r.id]));
    await autoCloseResolved();
    await expectAppError(submitSurvey(req, r.id, { rating: "bad" }), 409);
    const open = await createTicket(req, input(), randomUUID());
    await expectAppError(submitSurvey(req, open.id, { rating: "good" }), 409);
    // The database enforces it too.
    await expect(
      withUser(U.contosoRequester, (tx) =>
        tx.query("insert into ticket_surveys (ticket_id, customer_id, requester_user_id, rating) values ($1, $2, $3, 'good')", [open.id, C, U.contosoRequester]),
      ),
    ).rejects.toThrow();
  });
});

describe("monthly reports", () => {
  it("counts this month's work for the customer only", async () => {
    const month = currentMonth();
    const tech = await principal(U.tech);
    const before = await buildReport(tech, { customerId: C, month });
    const r = await resolvedTicket();
    await submitSurvey(await principal(U.contosoRequester), r.id, { rating: "bad", comment: "Slow" });
    await resolvedTicket(U.fabrikamRequester).catch(() => undefined); // Tess can't work Fabrikam tickets; ignore
    const after = await buildReport(tech, { customerId: C, month });
    expect(after.created).toBe(before.created + 1);
    expect(after.resolved).toBe(before.resolved + 1);
    expect(after.satisfaction.bad).toBe(before.satisfaction.bad + 1);
    expect(after.comments.some((c) => c.comment === "Slow")).toBe(true);
    expect(after.byCategory.find((x) => x.category === "network")!.count).toBeGreaterThan(0);
    expect(after.daily.length).toBeGreaterThanOrEqual(28);
    expect(after.daily.reduce((a, d) => a + d.created, 0)).toBe(after.created);
    expect(after.medianFirstResponseMinutes).not.toBeNull();
    expect(after.topRequesters[0].count).toBeGreaterThan(0);
  });

  it("client admins see their own organization without SLA or comments; requesters see none", async () => {
    const month = currentMonth();
    const admin = await buildReport(await principal(U.contosoAdmin), { customerId: C, month });
    expect(admin.staffView).toBe(false);
    expect(admin.sla).toBeNull();
    expect(admin.comments).toEqual([]);
    await expectAppError(buildReport(await principal(U.contosoRequester), { customerId: C, month }), 403);
    await expectAppError(buildReport(await principal(U.contosoAdmin), { customerId: F, month }), 403);
    await expectAppError(buildReport(await principal(U.tech), { customerId: F, month }), 403);
    await expectAppError(buildReport(await principal(U.tech), { customerId: C, month: "2026-13" }), 422);
  });

  it("exports CSV for technicians only, with formulas neutralised", async () => {
    await createTicket(await principal(U.contosoRequester), input({ title: "=HYPERLINK(\"http://evil\")" }), randomUUID());
    const csv = await exportTicketsCsv(await principal(U.tech), { customerId: C, month: currentMonth() });
    expect(csv.split("\r\n")[0]).toContain("First response met");
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    await expectAppError(exportTicketsCsv(await principal(U.contosoAdmin), { customerId: C, month: currentMonth() }), 403);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("plain")).toBe("plain");
  });

  it("uses Pacific month boundaries", () => {
    const { start, end } = monthRange("2026-03");
    expect(start.toISOString()).toBe("2026-03-01T08:00:00.000Z");
    expect(end.toISOString()).toBe("2026-04-01T07:00:00.000Z");
  });
});
