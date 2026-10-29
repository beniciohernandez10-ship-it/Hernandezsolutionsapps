import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem } from "@/lib/db";
import { setConfigForTesting } from "@/lib/config";
import { setResendFetchForTesting } from "@/lib/email/resend";
import { processJobs } from "@/lib/jobs";
import { generateDueReports, previousMonth } from "@/lib/reports/monthly";
import { currentMonth } from "@/lib/reports/service";
import { emailReportNow, reportEmailStatus, setReportEmails } from "@/lib/reports/emails";
import { lookupUnsubscribe } from "@/lib/notify/unsubscribe";

const U = DEMO.users;
const C = DEMO.customers.contoso;
const ORIGIN = "http://localhost:3000";

const sent: Record<string, unknown>[] = [];
const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (new URL(String(input)).pathname === "/emails") {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ id: randomUUID() });
  }
  return new Response("unexpected", { status: 500 });
}) as typeof fetch;

let coraEmail: string;
const toCora = () => sent.filter((m) => (m.to as string[])[0] === coraEmail);

beforeAll(async () => {
  await freshDatabase();
  setResendFetchForTesting(fakeFetch);
  // Demo users are never emailed; make the Contoso administrator a real-looking recipient.
  await asSystem((tx) => tx.query("update users set is_demo = false where id = $1", [U.contosoAdmin]));
  coraEmail = (await principal(U.contosoAdmin)).email;
});

beforeEach(() => {
  setConfigForTesting({ appOrigin: ORIGIN, demoMode: true, email: { resendApiKey: "re_test", from: "IT Center <support@example.test>" } });
});

describe("month-end report emails", () => {
  it("are off until an operator turns them on; then the cron sends each administrator one summary", async () => {
    const op = await principal(U.operator);
    const month = previousMonth(currentMonth());
    await generateDueReports();
    await processJobs({ limit: 100 });
    expect(toCora()).toHaveLength(0);

    await setReportEmails(op, C, { enabled: true });
    await asSystem((tx) => tx.query("delete from monthly_reports where customer_id = $1", [C]));
    await generateDueReports();
    await generateDueReports();
    await processJobs({ limit: 100 });
    expect(toCora()).toHaveLength(1);
    const mail = toCora()[0];
    expect(mail.subject).toContain("IT support report for");
    expect(String(mail.text)).toContain(`${ORIGIN}/portal/reports?customer=${C}&month=${month}`);
    expect(String(mail.text)).toContain("Requests opened:");
    const token = /\/api\/unsubscribe\/([A-Za-z0-9_-]+)>$/.exec((mail.headers as Record<string, string>)["List-Unsubscribe"])![1];
    expect(await lookupUnsubscribe(token)).toMatchObject({ category: "email_reports", label: "Monthly reports" });

    const reportId = (await asSystem((tx) => tx.query<{ id: string }>("select id from monthly_reports where customer_id = $1 and month = $2", [C, month]))).rows[0].id;
    const status = await reportEmailStatus(op, reportId);
    expect(status.automatic).toBe(true);
    expect(status.sent.map((s) => s.name)).toHaveLength(1);
  });

  it("operators can send one now; people who opted out are skipped", async () => {
    const op = await principal(U.operator);
    const reportId = (await asSystem((tx) => tx.query<{ id: string }>("select id from monthly_reports where customer_id = $1 limit 1", [C]))).rows[0].id;
    sent.length = 0;
    expect(await emailReportNow(op, reportId)).toEqual({ queued: 1 });
    await processJobs({ limit: 50 });
    expect(toCora()).toHaveLength(1);

    await asSystem((tx) => tx.query("insert into notification_preferences (user_id, email_reports) values ($1, false) on conflict (user_id) do update set email_reports = false", [U.contosoAdmin]));
    sent.length = 0;
    await emailReportNow(op, reportId);
    await processJobs({ limit: 50 });
    expect(toCora()).toHaveLength(0);
    expect((await reportEmailStatus(op, reportId)).admins.find((a) => a.optedOut)).toBeTruthy();

    await expectAppError(emailReportNow(await principal(U.manager), reportId), 403);
    await expectAppError(setReportEmails(await principal(U.contosoAdmin), C, { enabled: false }), 403);
    setConfigForTesting({ appOrigin: ORIGIN, demoMode: true, email: { resendApiKey: "", from: "" } });
    await expectAppError(emailReportNow(op, reportId), 422);
  });
});
