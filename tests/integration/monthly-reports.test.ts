import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem } from "@/lib/db";
import { createTicket, getTicket, updateTicket } from "@/lib/tickets/service";
import { currentMonth } from "@/lib/reports/service";
import { generateDueReports, getMonthlyReport, listMonthlyReports, monthlyReportCsv, previousMonth, runMonthlyReport } from "@/lib/reports/monthly";

const U = DEMO.users;
const C = DEMO.customers.contoso;
const month = currentMonth();

async function resolvedTicket(title: string, category: string, resolution: string, dueOffsetHours: number | null) {
  const t = await createTicket(await principal(U.contosoRequester), { title, description: "Details", priority: "normal", category }, randomUUID());
  if (dueOffsetHours !== null) {
    await asSystem((tx) => tx.query("update tickets set resolution_due_at = now() + make_interval(hours => $2::int) where id = $1", [t.id, dueOffsetHours]));
  }
  const tech = await principal(U.tech);
  const cur = await getTicket(tech, t.id);
  await updateTicket(tech, t.id, { expectedVersion: cur.version, status: "resolved", resolution });
  return t;
}

beforeAll(async () => {
  await freshDatabase();
  await resolvedTicket("Printer jam at reception", "hardware", "Cleared the jam and replaced the toner.", 4);
  await resolvedTicket("=HYPERLINK(\"x\") Outlook password prompts", "email", "Reset the cached credentials.", -4);
  await resolvedTicket("Wi-Fi slow upstairs", "network", "Moved the access point.", null);
});

describe("monthly client reports", () => {
  it("lists each resolved request with how it was solved, who solved it and its target", async () => {
    const { id } = await runMonthlyReport(await principal(U.operator), { customerId: C, month });
    const { report, generatedBy } = await getMonthlyReport(await principal(U.operator), id);
    expect(generatedBy).toBeTruthy();
    const jam = report.resolvedTickets.find((t) => t.title === "Printer jam at reception")!;
    expect(jam).toMatchObject({ resolvedBy: "Tess Torres (Demo)", resolution: "Cleared the jam and replaced the toner.", resolutionTarget: "met", category: "hardware" });
    expect(report.resolvedTickets.find((t) => t.title.includes("Outlook"))?.resolutionTarget).toBe("missed");
    expect(report.resolvedTickets.find((t) => t.title === "Wi-Fi slow upstairs")?.resolutionTarget).toBe("none");
    expect(report.summary).toMatchObject({ slaTracked: 2, slaMet: 1, slaMissed: 1 });
    expect(report.summary.resolved).toBeGreaterThanOrEqual(3);
    expect(report.byCategory.find((c) => c.category === "network")?.count).toBeGreaterThanOrEqual(1);
    expect(report.byTechnician.find((t) => t.name === "Tess Torres (Demo)")?.count).toBeGreaterThanOrEqual(3);
  });

  it("keeps the saved data until the report is rebuilt", async () => {
    const op = await principal(U.operator);
    const [saved] = (await listMonthlyReports(op)).filter((r) => r.customerId === C && r.month === month);
    await resolvedTicket("Monitor flickers", "hardware", "Replaced the cable.", null);
    expect((await getMonthlyReport(op, saved.id)).report.resolvedTickets.some((t) => t.title === "Monitor flickers")).toBe(false);
    const again = await runMonthlyReport(op, { customerId: C, month });
    expect(again.id).toBe(saved.id);
    expect((await getMonthlyReport(op, saved.id)).report.resolvedTickets.some((t) => t.title === "Monitor flickers")).toBe(true);
  });

  it("exports CSV with spreadsheet formulas neutralised", async () => {
    const op = await principal(U.operator);
    const [saved] = (await listMonthlyReports(op)).filter((r) => r.customerId === C && r.month === month);
    const { csv, filename } = await monthlyReportCsv(op, saved.id);
    expect(filename).toMatch(/-service-report\.csv$/);
    expect(csv).toContain("Cleared the jam and replaced the toner.");
    expect(csv).toContain(`"'=HYPERLINK(""x"") Outlook password prompts"`);
  });

  it("is for platform operators only", async () => {
    await expectAppError(runMonthlyReport(await principal(U.manager), { customerId: C, month }), 403);
    await expectAppError(listMonthlyReports(await principal(U.contosoAdmin)), 403);
    await expectAppError(runMonthlyReport(await principal(U.operator), { customerId: C, month: "2999-01" }), 422);
  });

  it("creates last month's reports automatically once, after the month ends", async () => {
    const now = new Date();
    const first = await generateDueReports(now);
    expect(first.month).toBe(previousMonth(month));
    const active = Number((await asSystem((tx) => tx.query<{ n: string }>("select count(*) as n from customers where status = 'active'"))).rows[0].n);
    expect(first.generated).toBe(active);
    expect((await generateDueReports(now)).generated).toBe(0);
    const auto = (await listMonthlyReports(await principal(U.operator))).filter((r) => r.month === previousMonth(month));
    expect(auto.every((r) => r.generatedBy === null)).toBe(true);
    const audit = await asSystem((tx) => tx.query("select 1 from audit_events where action = 'report.generated' and actor_user_id is null"));
    expect(audit.rows.length).toBe(active);
  });
});
