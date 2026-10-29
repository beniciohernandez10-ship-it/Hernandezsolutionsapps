import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asSystem, type Queryable } from "../db";
import { requireOperator, type Principal } from "../authz";
import { config, emailSendingEnabled } from "../config";
import { AppError, notFound } from "../errors";
import { enqueue } from "../jobs-queue";
import { monthLabel } from "../billing/compute";
import { sendEmail } from "../email/resend";
import { renderReportEmail } from "../email/templates";
import { issueUnsubscribeToken } from "../notify/unsubscribe";
import type { MonthlyReport } from "./monthly";

/**
 * Month-end report emails to each client's administrators. Sent
 * automatically when the cron generates a report for a client that has them
 * turned on, or on demand by an operator. Totals only, with a link to the
 * full report in the portal.
 */

/** Queues one email per active client administrator. Automatic runs send each report once per person. */
export async function queueReportEmails(tx: Queryable, reportId: string, customerId: string, opts: { manual: boolean }) {
  if (!emailSendingEnabled()) return 0;
  const admins = await tx.query<{ id: string }>(
    `select u.id from memberships m join users u on u.id = m.user_id
      where m.customer_id = $1 and m.role = 'client_admin' and m.revoked_at is null and u.status = 'active' and not u.is_demo and not u.is_system`,
    [customerId],
  );
  for (const a of admins.rows) {
    const key = opts.manual ? `report-email:${reportId}:${a.id}:${randomUUID()}` : `report-email:${reportId}:${a.id}`;
    await enqueue(tx, "report.email", customerId, { reportId, userId: a.id, key }, key);
  }
  return admins.rows.length;
}

/** Job handler: sends one report email, if the person still wants it and still administers the client. */
export async function sendReportEmail(payload: unknown) {
  const { reportId, userId, key } = z.object({ reportId: z.uuid(), userId: z.uuid(), key: z.string().max(200) }).parse(payload);
  const ctx = await asSystem(async (tx) => {
    const r = await tx.query<{ customer_id: string; month: string; data: MonthlyReport; email: string; email_enabled: boolean | null; email_reports: boolean | null }>(
      `select r.customer_id, r.month, r.data, u.email, p.email_enabled, p.email_reports
         from monthly_reports r
         join memberships m on m.customer_id = r.customer_id and m.user_id = $2 and m.role = 'client_admin' and m.revoked_at is null
         join users u on u.id = m.user_id and u.status = 'active'
         left join notification_preferences p on p.user_id = u.id
        where r.id = $1`,
      [reportId, userId],
    );
    const row = r.rows[0];
    if (!row || row.email_enabled === false || row.email_reports === false) return null;
    return { row, token: await issueUnsubscribeToken(tx, userId, "email_reports") };
  });
  if (!ctx) return { skipped: true };
  const { row, token } = ctx;
  const origin = config().appOrigin;
  const s = row.data.summary;
  const mail = renderReportEmail({
    customerName: row.data.customerName,
    monthLabel: monthLabel(row.month),
    opened: s.opened,
    resolved: s.resolved,
    stillOpen: s.stillOpen,
    medianResolutionHours: s.medianResolutionHours,
    slaTracked: s.slaTracked,
    slaMet: s.slaMet,
    satisfactionGood: s.satisfactionGood,
    satisfactionBad: s.satisfactionBad,
    reportUrl: `${origin}/portal/reports?customer=${row.customer_id}&month=${row.month}`,
    settingsUrl: `${origin}/portal/settings`,
    unsubscribeUrl: `${origin}/unsubscribe/${token}`,
  });
  await sendEmail({
    to: row.email,
    ...mail,
    headers: { "List-Unsubscribe": `<${origin}/api/unsubscribe/${token}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    idempotencyKey: key,
  });
  await asSystem(async (tx) => {
    await tx.query("insert into report_email_log (report_id, user_id) values ($1, $2)", [reportId, userId]);
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values (null, $1, 'report.emailed', 'monthly_report', $2, $3)",
      [row.customer_id, reportId, JSON.stringify({ userId })],
    );
  });
  return { sent: true };
}

/** Operator: turn automatic month-end emails on or off for a client. */
export async function setReportEmails(p: Principal, customerId: string, raw: unknown) {
  requireOperator(p);
  const { enabled } = z.object({ enabled: z.boolean() }).parse(raw);
  return asSystem(async (tx) => {
    const r = await tx.query("update customers set report_emails = $2 where id = $1 returning id", [customerId, enabled]);
    if (!r.rows[0]) throw notFound("Client");
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'report.emails_setting', 'customer', $3, $4)",
      [p.userId, customerId, customerId, JSON.stringify({ enabled })],
    );
    return { enabled };
  });
}

/** Operator: email a saved report to the client's administrators now. */
export async function emailReportNow(p: Principal, reportId: string) {
  requireOperator(p);
  if (!emailSendingEnabled()) throw new AppError(422, "validation_failed", "Email isn't set up for the IT Center yet.");
  return asSystem(async (tx) => {
    const r = await tx.query<{ customer_id: string }>("select customer_id from monthly_reports where id = $1", [reportId]);
    if (!r.rows[0]) throw notFound("Report");
    const queued = await queueReportEmails(tx, reportId, r.rows[0].customer_id, { manual: true });
    if (!queued) throw new AppError(422, "validation_failed", "This client has no administrators to send it to.");
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'report.email_requested', 'monthly_report', $3, $4)",
      [p.userId, r.rows[0].customer_id, reportId, JSON.stringify({ recipients: queued })],
    );
    return { queued };
  });
}

export interface ReportEmailStatus {
  automatic: boolean;
  admins: { name: string; optedOut: boolean }[];
  sent: { name: string; sentAt: string }[];
}

export async function reportEmailStatus(p: Principal, reportId: string): Promise<ReportEmailStatus> {
  requireOperator(p);
  return asSystem(async (tx) => {
    const r = await tx.query<{ customer_id: string; report_emails: boolean }>(
      "select r.customer_id, c.report_emails from monthly_reports r join customers c on c.id = r.customer_id where r.id = $1",
      [reportId],
    );
    if (!r.rows[0]) throw notFound("Report");
    const admins = await tx.query<{ display_name: string; opted_out: boolean }>(
      `select u.display_name, (coalesce(p.email_enabled, true) = false or coalesce(p.email_reports, true) = false) as opted_out
         from memberships m join users u on u.id = m.user_id left join notification_preferences p on p.user_id = u.id
        where m.customer_id = $1 and m.role = 'client_admin' and m.revoked_at is null and u.status = 'active' order by u.display_name`,
      [r.rows[0].customer_id],
    );
    const sent = await tx.query<{ display_name: string; sent_at: Date | string }>(
      "select u.display_name, l.sent_at from report_email_log l join users u on u.id = l.user_id where l.report_id = $1 order by l.sent_at desc limit 20",
      [reportId],
    );
    return {
      automatic: r.rows[0].report_emails,
      admins: admins.rows.map((a) => ({ name: a.display_name, optedOut: a.opted_out })),
      sent: sent.rows.map((s) => ({ name: s.display_name, sentAt: new Date(s.sent_at).toISOString() })),
    };
  });
}
