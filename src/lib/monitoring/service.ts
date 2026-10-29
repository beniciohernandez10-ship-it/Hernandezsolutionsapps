import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { asSystem, withUser, type Queryable } from "../db";
import { customersWhere, isStaffAnywhere, requireOperator, STAFF_ROLES, type Principal } from "../authz";
import { AppError, forbidden, notFound } from "../errors";
import { enqueue } from "../jobs-queue";
import { log } from "../log";
import { applySlaTransition } from "../sla/service";
import type { Category, Priority } from "../tickets/schemas";
import { createSystemTicket, SYSTEM_USERS } from "../tickets/system";

/**
 * Monitoring alerts become tickets.
 *
 * An alert is "the same problem" by (client, fingerprint). The first time it
 * fires it is recorded and, if it's serious enough, opens a ticket from the
 * IT Center Monitoring account. Repeats are counted on the same alert. When
 * the condition clears, the ticket gets an internal note and, if nobody has
 * picked it up yet, is resolved automatically.
 *
 * Sources: built-in checks over data the IT Center already has (Intune
 * compliance, devices that stopped checking in, warranties ending, licenses
 * running out), and external tools posting to /api/alerts/{sourceId}.
 */

export const MONITORING_USER = SYSTEM_USERS.monitoring;

export type Severity = "info" | "warning" | "critical";
export type AlertSource = "intune_compliance" | "device_stale" | "warranty" | "licenses" | "webhook";

const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };
const PRIORITY: Record<Severity, Priority> = { info: "low", warning: "normal", critical: "high" };
const CATEGORY: Record<AlertSource, Category> = {
  intune_compliance: "security",
  device_stale: "hardware",
  warranty: "hardware",
  licenses: "account_access",
  webhook: "other",
};
const SOURCE_LABEL: Record<AlertSource, string> = {
  intune_compliance: "Intune compliance",
  device_stale: "Device check-in",
  warranty: "Warranty",
  licenses: "Microsoft 365 licenses",
  webhook: "External monitoring",
};

/** Hours a resolved ticket must have been resolved before the same alert opens a new one (stops flapping). */
const REOPEN_AFTER_HOURS = 24;

export interface AlertInput {
  customerId: string;
  source: AlertSource;
  sourceId?: string | null;
  fingerprint: string;
  title: string;
  severity: Severity;
  details?: string | null;
  deviceId?: string | null;
  assetId?: string | null;
  /** Lowest severity that opens a ticket. */
  ticketAt: Severity;
}

async function audit(tx: Queryable, customerId: string, action: string, targetId: string, details: object) {
  await tx.query(
    "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values (null, $1, $2, 'monitor_alert', $3, $4)",
    [customerId, action, targetId, JSON.stringify(details)],
  );
}

/** Opens a ticket for an alert, from the Monitoring account (system context). */
async function openTicket(tx: Queryable, a: AlertInput, alertId: string) {
  const description = [
    `${SOURCE_LABEL[a.source]} raised this automatically.`,
    "",
    a.details?.trim() || a.title,
    "",
    "When the problem clears, this request is updated, and resolved if nobody has picked it up.",
  ].join("\n");
  const t = await createSystemTicket(tx, {
    customerId: a.customerId,
    requesterId: MONITORING_USER,
    source: "monitoring",
    kind: "incident",
    title: a.title,
    description,
    priority: PRIORITY[a.severity],
    category: CATEGORY[a.source],
    deviceId: a.deviceId,
  });
  await tx.query("update monitor_alerts set ticket_id = $2 where id = $1", [alertId, t.id]);
  await audit(tx, a.customerId, "monitoring.ticket", alertId, { ticketId: t.id, number: t.number, severity: a.severity });
  return t.id;
}

async function internalNote(tx: Queryable, ticketId: string, customerId: string, body: string) {
  await tx.query(
    "insert into ticket_messages (ticket_id, customer_id, author_user_id, visibility, body) values ($1, $2, $3, 'internal', $4)",
    [ticketId, customerId, MONITORING_USER, body.slice(0, 20000)],
  );
  await tx.query("update tickets set updated_at = now(), version = version + 1 where id = $1", [ticketId]);
}

/** Records one firing of an alert; opens or re-opens a ticket when it should. Runs in system context. */
export async function raiseAlert(tx: Queryable, a: AlertInput) {
  const existing = await tx.query<{ id: string; severity: Severity; ticket_id: string | null; occurrences: number }>(
    "select id, severity, ticket_id, occurrences from monitor_alerts where customer_id = $1 and fingerprint = $2 and status = 'open' for update",
    [a.customerId, a.fingerprint],
  );
  const prev = existing.rows[0];
  if (!prev) {
    const r = await tx.query<{ id: string }>(
      `insert into monitor_alerts (customer_id, source, source_id, fingerprint, title, severity, details, device_id, asset_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [a.customerId, a.source, a.sourceId ?? null, a.fingerprint, a.title.slice(0, 200), a.severity, a.details?.slice(0, 4000) ?? null, a.deviceId ?? null, a.assetId ?? null],
    );
    const alertId = r.rows[0].id;
    await audit(tx, a.customerId, "monitoring.alert", alertId, { source: a.source, severity: a.severity, title: a.title });
    const ticketId = RANK[a.severity] >= RANK[a.ticketAt] ? await openTicket(tx, a, alertId) : null;
    return { alertId, ticketId, created: true };
  }
  // A worse severity replaces the old one; details follow the latest report.
  const severity = RANK[a.severity] > RANK[prev.severity] ? a.severity : prev.severity;
  await tx.query(
    `update monitor_alerts set last_seen_at = now(), occurrences = occurrences + 1, severity = $2, title = $3, details = coalesce($4, details) where id = $1`,
    [prev.id, severity, a.title.slice(0, 200), a.details?.slice(0, 4000) ?? null],
  );
  let ticketId = prev.ticket_id;
  if (ticketId) {
    const t = await tx.query<{ status: string; resolved_at: string | null }>("select status, resolved_at from tickets where id = $1", [ticketId]);
    const done = t.rows[0] && (t.rows[0].status === "resolved" || t.rows[0].status === "closed");
    const longAgo = done && t.rows[0].resolved_at && Date.now() - Date.parse(t.rows[0].resolved_at) > REOPEN_AFTER_HOURS * 3600_000;
    if (!t.rows[0] || longAgo) {
      // The ticket was closed but the problem is still there: a fresh ticket, linked to the same alert.
      ticketId = await openTicket(tx, { ...a, severity }, prev.id);
    }
  } else if (RANK[severity] >= RANK[a.ticketAt]) {
    ticketId = await openTicket(tx, { ...a, severity }, prev.id);
  }
  return { alertId: prev.id, ticketId, created: false };
}

/** The condition cleared: closes the alert, tells its ticket, and resolves the ticket if nobody picked it up. */
export async function clearAlert(tx: Queryable, customerId: string, fingerprint: string, opts: { autoResolve?: boolean } = {}) {
  const r = await tx.query<{ id: string; title: string; ticket_id: string | null }>(
    "update monitor_alerts set status = 'resolved', resolved_at = now() where customer_id = $1 and fingerprint = $2 and status = 'open' returning id, title, ticket_id",
    [customerId, fingerprint],
  );
  const alert = r.rows[0];
  if (!alert) return { cleared: false };
  await audit(tx, customerId, "monitoring.cleared", alert.id, { title: alert.title });
  if (!alert.ticket_id) return { cleared: true };
  const t = await tx.query<{ status: string; assignee_user_id: string | null }>("select status, assignee_user_id from tickets where id = $1", [alert.ticket_id]);
  const ticket = t.rows[0];
  if (!ticket || ticket.status === "resolved" || ticket.status === "closed") return { cleared: true };
  await internalNote(tx, alert.ticket_id, customerId, `Monitoring: the alert cleared. "${alert.title}" is no longer reported.`);
  await tx.query("insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, to_value) values ($1, $2, null, 'alert_cleared', $3)", [
    alert.ticket_id,
    customerId,
    alert.title.slice(0, 200),
  ]);
  const staffReplied = await tx.query(
    "select 1 from ticket_messages m where m.ticket_id = $1 and m.author_user_id <> $2 limit 1",
    [alert.ticket_id, MONITORING_USER],
  );
  if (opts.autoResolve !== false && ticket.status === "open" && !ticket.assignee_user_id && !staffReplied.rows[0]) {
    await tx.query(
      `update tickets set status = 'resolved', resolved_at = now(), resolution_note = $2, updated_at = now(), version = version + 1 where id = $1`,
      [alert.ticket_id, `Cleared automatically: monitoring stopped reporting "${alert.title}".`.slice(0, 5000)],
    );
    await tx.query("insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, from_value, to_value) values ($1, $2, null, 'status_changed', 'open', 'resolved')", [
      alert.ticket_id,
      customerId,
    ]);
    await applySlaTransition(tx, alert.ticket_id, { fromStatus: "open", toStatus: "resolved" });
    return { cleared: true, resolved: true };
  }
  return { cleared: true, resolved: false };
}

// ---------------------------------------------------------------- built-in checks

export interface MonitorSettings {
  intuneCompliance: boolean;
  staleDeviceDays: number;
  warrantyDays: number;
  licenseShortage: boolean;
}
export const DEFAULT_SETTINGS: MonitorSettings = { intuneCompliance: true, staleDeviceDays: 14, warrantyDays: 30, licenseShortage: true };

async function settingsFor(tx: Queryable, customerId: string): Promise<MonitorSettings> {
  const r = await tx.query<Record<string, unknown>>("select * from monitor_settings where customer_id = $1", [customerId]);
  const s = r.rows[0];
  return s
    ? {
        intuneCompliance: Boolean(s.intune_compliance),
        staleDeviceDays: Number(s.stale_device_days),
        warrantyDays: Number(s.warranty_days),
        licenseShortage: Boolean(s.license_shortage),
      }
    : DEFAULT_SETTINGS;
}

const dateOnly = (v: unknown) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : "");

/** Raises what's wrong now and clears what isn't, for one client and one built-in source. */
async function reconcile(
  tx: Queryable,
  customerId: string,
  source: AlertSource,
  firing: Omit<AlertInput, "customerId" | "source">[],
  opts: { autoResolve?: boolean } = {},
) {
  const open = await tx.query<{ fingerprint: string }>("select fingerprint from monitor_alerts where customer_id = $1 and source = $2 and status = 'open'", [customerId, source]);
  const now = new Set(firing.map((f) => f.fingerprint));
  let raised = 0;
  let cleared = 0;
  for (const f of firing) {
    await raiseAlert(tx, { ...f, customerId, source });
    raised++;
  }
  for (const o of open.rows) {
    if (!now.has(o.fingerprint)) {
      await clearAlert(tx, customerId, o.fingerprint, opts);
      cleared++;
    }
  }
  return { raised, cleared };
}

/** All built-in checks for every active client. Idempotent: run as often as you like. */
export async function runMonitoringChecks(now = new Date()) {
  const customers = await asSystem((tx) => tx.query<{ id: string }>("select id from customers where status = 'active'"));
  const summary = { customers: 0, raised: 0, cleared: 0 };
  for (const c of customers.rows) {
    await asSystem(async (tx) => {
      const s = await settingsFor(tx, c.id);
      const add = (r: { raised: number; cleared: number }) => {
        summary.raised += r.raised;
        summary.cleared += r.cleared;
      };

      const bad = s.intuneCompliance
        ? (
            await tx.query<{ id: string; name: string; compliance_state: string }>(
              `select id, name, compliance_state from devices
                where customer_id = $1 and removed_at is null and source = 'intune' and compliance_state in ('noncompliant', 'error', 'conflict')`,
              [c.id],
            )
          ).rows
        : [];
      add(
        await reconcile(
          tx,
          c.id,
          "intune_compliance",
          bad.map((d) => ({
            fingerprint: `intune:noncompliant:${d.id}`,
            title: `${d.name} is not compliant in Intune`,
            severity: "warning" as const,
            details: `Intune reports ${d.name} as ${d.compliance_state === "noncompliant" ? "not compliant" : d.compliance_state}. Check its compliance policies (encryption, OS version, antivirus) in Intune.`,
            deviceId: d.id,
            ticketAt: "warning" as const,
          })),
        ),
      );

      const stale =
        s.staleDeviceDays > 0
          ? (
              await tx.query<{ id: string; name: string; last_provider_sync_at: string }>(
                `select id, name, last_provider_sync_at from devices
                  where customer_id = $1 and removed_at is null and source in ('intune', 'atera')
                    and last_provider_sync_at < $2::timestamptz - make_interval(days => $3)`,
                [c.id, now.toISOString(), s.staleDeviceDays],
              )
            ).rows
          : [];
      add(
        await reconcile(
          tx,
          c.id,
          "device_stale",
          stale.map((d) => ({
            fingerprint: `device:stale:${d.id}`,
            title: `${d.name} hasn't checked in for over ${s.staleDeviceDays} days`,
            severity: "warning" as const,
            details: `${d.name} last checked in on ${dateOnly(d.last_provider_sync_at)}. It may be switched off, lost, or no longer managed.`,
            deviceId: d.id,
            ticketAt: "warning" as const,
          })),
        ),
      );

      const today = now.toISOString().slice(0, 10);
      const ending =
        s.warrantyDays > 0
          ? (
              await tx.query<{ id: string; tag: string; model: string | null; warranty_expires: string }>(
                `select id, tag, model, warranty_expires from assets
                  where customer_id = $1 and status = 'active' and warranty_expires between $2::date - 30 and $2::date + $3::int`,
                [c.id, today, s.warrantyDays],
              )
            ).rows
          : [];
      add(
        await reconcile(
          tx,
          c.id,
          "warranty",
          ending.map((a) => ({
            fingerprint: `warranty:${a.id}:${dateOnly(a.warranty_expires)}`,
            title: `Warranty for ${a.tag} ${dateOnly(a.warranty_expires) < today ? "ended" : "ends"} ${dateOnly(a.warranty_expires)}`,
            severity: "info" as const,
            details: `${a.tag}${a.model ? ` (${a.model})` : ""}: the warranty ends on ${dateOnly(a.warranty_expires)}. Decide whether to extend it or plan a replacement.`,
            assetId: a.id,
            ticketAt: "info" as const,
          })),
          // A warranty "clearing" just means its date passed: note it, but leave the decision to a person.
          { autoResolve: false },
        ),
      );

      const short = s.licenseShortage
        ? (
            await tx.query<{ sku_id: string; sku_part_number: string; enabled: number; consumed: number }>(
              "select sku_id, sku_part_number, enabled, consumed from license_inventory where customer_id = $1 and enabled > 0 and consumed >= enabled",
              [c.id],
            )
          ).rows
        : [];
      add(
        await reconcile(
          tx,
          c.id,
          "licenses",
          short.map((l) => ({
            fingerprint: `licenses:${l.sku_id}`,
            title: `No spare ${l.sku_part_number} licenses`,
            severity: "warning" as const,
            details: `All ${l.enabled} ${l.sku_part_number} licenses are assigned (${l.consumed} in use). The next new hire or reassignment will need another license.`,
            ticketAt: "warning" as const,
          })),
        ),
      );
    });
    summary.customers++;
  }
  log.info("monitoring.checked", summary);
  return summary;
}

/** Queues the checks, at most once an hour however often it's asked. */
export async function scheduleMonitoring(now = new Date()) {
  await asSystem((tx) => enqueue(tx, "monitoring.check", null, {}, `monitoring:${now.toISOString().slice(0, 13)}`));
}

// ---------------------------------------------------------------- external alerts (webhook)

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const severityIn = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s): Severity => {
    if (["critical", "crit", "high", "error", "emergency", "fatal", "p1", "sev1"].includes(s)) return "critical";
    if (["warning", "warn", "medium", "major", "p2", "sev2"].includes(s)) return "warning";
    return "info";
  });

export const alertPayload = z.object({
  /** Stable ID of the problem in the sending tool; repeats with the same ID update one alert. */
  id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().trim().min(1).max(200)),
  title: z.string().trim().min(1).max(200),
  severity: severityIn.default("warning"),
  /** "firing" (default) or "resolved". */
  status: z
    .string()
    .trim()
    .toLowerCase()
    .transform((s) => (["resolved", "ok", "closed", "cleared", "recovered", "up"].includes(s) ? "resolved" : "firing"))
    .default("firing"),
  description: z.string().max(4000).optional(),
  /** Computer name or asset tag, linked to the device when it matches. */
  device: z.string().trim().max(120).optional(),
  /** For multi-client sources: the client's Atera customer ID. */
  ateraCustomerId: z.union([z.string(), z.number()]).transform(String).pipe(z.string().regex(/^\d{1,18}$/)).optional(),
  url: z.url().max(500).optional(),
});

/** Accepts one alert from an external tool. The token identifies and authorises the source. */
export async function ingestAlert(sourceId: string, token: string | null, raw: unknown) {
  if (!/^[0-9a-f-]{36}$/i.test(sourceId) || !token) throw new AppError(401, "unauthenticated", "Missing or unknown alert token.");
  return asSystem(async (tx) => {
    const s = await tx.query<{ id: string; customer_id: string | null; token_hash: string; min_severity: Severity; auto_resolve: boolean; name: string }>(
      "select id, customer_id, token_hash, min_severity, auto_resolve, name from alert_sources where id = $1 and active",
      [sourceId],
    );
    const src = s.rows[0];
    if (!src || src.token_hash !== hashToken(token)) throw new AppError(401, "unauthenticated", "Missing or unknown alert token.");
    // Authenticate first: an unknown caller learns nothing about the alert format.
    const a = alertPayload.parse(raw);
    let customerId = src.customer_id;
    if (!customerId) {
      if (!a.ateraCustomerId) throw new AppError(422, "validation_failed", "This source covers several clients: include ateraCustomerId.");
      const m = await tx.query<{ customer_id: string }>(
        "select customer_id from customer_atera_mappings where atera_customer_id = $1 and verified_at is not null",
        [a.ateraCustomerId],
      );
      if (!m.rows[0]) throw new AppError(422, "validation_failed", "That Atera customer isn't mapped to a client in the IT Center.");
      customerId = m.rows[0].customer_id;
    }
    await tx.query("update alert_sources set last_received_at = now() where id = $1", [src.id]);
    const fingerprint = `webhook:${src.id}:${a.id}`;
    if (a.status === "resolved") {
      const r = await clearAlert(tx, customerId, fingerprint, { autoResolve: src.auto_resolve });
      return { status: r.cleared ? "cleared" : "no_open_alert" };
    }
    let deviceId: string | null = null;
    if (a.device) {
      const d = await tx.query<{ id: string }>(
        "select id from devices where customer_id = $1 and removed_at is null and upper(name) = upper($2) limit 1",
        [customerId, a.device],
      );
      deviceId = d.rows[0]?.id ?? null;
    }
    const details = [a.description, a.device ? `Device: ${a.device}` : null, a.url ? `More: ${a.url}` : null, `Source: ${src.name}`].filter(Boolean).join("\n");
    const r = await raiseAlert(tx, {
      customerId,
      source: "webhook",
      sourceId: src.id,
      fingerprint,
      title: a.title,
      severity: a.severity,
      details,
      deviceId,
      ticketAt: src.min_severity,
    });
    return { status: r.created ? "opened" : "updated", ticket: Boolean(r.ticketId) };
  });
}

// ---------------------------------------------------------------- views and settings

export interface AlertRow {
  id: string;
  customerId: string;
  customerName: string;
  source: AlertSource;
  sourceLabel: string;
  title: string;
  severity: Severity;
  status: "open" | "resolved";
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  ticketId: string | null;
  ticketNumber: number | null;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Alerts for the clients a technician supports. */
export async function listAlerts(p: Principal, opts: { status?: "open" | "resolved"; customerId?: string } = {}): Promise<AlertRow[]> {
  if (!isStaffAnywhere(p)) throw forbidden("Only technicians can see monitoring alerts.");
  const mine = customersWhere(p, (r) => STAFF_ROLES.includes(r));
  const scope = opts.customerId && mine.includes(opts.customerId) ? [opts.customerId] : mine;
  return withUser(p.userId, async (tx) => {
    const r = await tx.query(
      `select a.*, c.name as customer_name, t.number as ticket_number from monitor_alerts a
         join customers c on c.id = a.customer_id left join tickets t on t.id = a.ticket_id
        where a.customer_id = any($1::uuid[]) and a.status = $2 order by a.last_seen_at desc limit 200`,
      [scope, opts.status ?? "open"],
    );
    return r.rows.map((x) => ({
      id: x.id as string,
      customerId: x.customer_id as string,
      customerName: x.customer_name as string,
      source: x.source as AlertSource,
      sourceLabel: SOURCE_LABEL[x.source as AlertSource],
      title: x.title as string,
      severity: x.severity as Severity,
      status: x.status as "open" | "resolved",
      occurrences: Number(x.occurrences),
      firstSeenAt: iso(x.first_seen_at)!,
      lastSeenAt: iso(x.last_seen_at)!,
      resolvedAt: iso(x.resolved_at),
      ticketId: (x.ticket_id as string) ?? null,
      ticketNumber: x.ticket_number ? Number(x.ticket_number) : null,
    }));
  });
}

export const settingsSchema = z.object({
  intuneCompliance: z.boolean(),
  staleDeviceDays: z.coerce.number().int().min(0).max(365),
  warrantyDays: z.coerce.number().int().min(0).max(365),
  licenseShortage: z.boolean(),
});

export async function monitoringSetup(p: Principal) {
  requireOperator(p);
  return asSystem(async (tx) => {
    const customers = await tx.query<{ id: string; name: string }>("select id, name from customers where status = 'active' order by name");
    const settings = [];
    for (const c of customers.rows) settings.push({ customerId: c.id, customerName: c.name, ...(await settingsFor(tx, c.id)) });
    const sources = await tx.query<Record<string, unknown>>(
      `select s.id, s.name, s.customer_id, c.name as customer_name, s.min_severity, s.auto_resolve, s.active, s.created_at, s.last_received_at
         from alert_sources s left join customers c on c.id = s.customer_id order by s.created_at`,
    );
    return {
      settings,
      sources: sources.rows.map((s) => ({
        id: s.id as string,
        name: s.name as string,
        customerId: (s.customer_id as string) ?? null,
        customerName: (s.customer_name as string) ?? null,
        minSeverity: s.min_severity as Severity,
        autoResolve: Boolean(s.auto_resolve),
        active: Boolean(s.active),
        lastReceivedAt: iso(s.last_received_at),
      })),
    };
  });
}

export async function saveMonitorSettings(p: Principal, customerId: string, raw: unknown) {
  requireOperator(p);
  const v = settingsSchema.parse(raw);
  return asSystem(async (tx) => {
    const c = await tx.query("select 1 from customers where id = $1", [customerId]);
    if (!c.rows[0]) throw notFound("Client");
    await tx.query(
      `insert into monitor_settings (customer_id, intune_compliance, stale_device_days, warranty_days, license_shortage, updated_by)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (customer_id) do update set intune_compliance = $2, stale_device_days = $3, warranty_days = $4, license_shortage = $5, updated_by = $6, updated_at = now()`,
      [customerId, v.intuneCompliance, v.staleDeviceDays, v.warrantyDays, v.licenseShortage, p.userId],
    );
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'monitoring.settings', 'customer', $3, $4)",
      [p.userId, customerId, customerId, JSON.stringify(v)],
    );
    return v;
  });
}

export const sourceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  customerId: z.uuid().nullable(),
  minSeverity: z.enum(["info", "warning", "critical"]).default("warning"),
  autoResolve: z.boolean().default(true),
});

/** Creates a source and returns its token once. Only the hash is stored. */
export async function createAlertSource(p: Principal, raw: unknown) {
  requireOperator(p);
  const v = sourceSchema.parse(raw);
  const token = randomBytes(32).toString("base64url");
  return asSystem(async (tx) => {
    const r = await tx.query<{ id: string }>(
      "insert into alert_sources (name, customer_id, token_hash, min_severity, auto_resolve, created_by) values ($1, $2, $3, $4, $5, $6) returning id",
      [v.name, v.customerId, hashToken(token), v.minSeverity, v.autoResolve, p.userId],
    );
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'monitoring.source_create', 'alert_source', $3, $4)",
      [p.userId, v.customerId, r.rows[0].id, JSON.stringify({ name: v.name })],
    );
    return { id: r.rows[0].id, token };
  });
}

/** New token (the old one stops working immediately). */
export async function rotateAlertSource(p: Principal, id: string) {
  requireOperator(p);
  const token = randomBytes(32).toString("base64url");
  return asSystem(async (tx) => {
    const r = await tx.query<{ customer_id: string | null }>("update alert_sources set token_hash = $2 where id = $1 returning customer_id", [id, hashToken(token)]);
    if (!r.rows[0]) throw notFound("Alert source");
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'monitoring.source_rotate', 'alert_source', $3, '{}')",
      [p.userId, r.rows[0].customer_id, id],
    );
    return { id, token };
  });
}

export async function deleteAlertSource(p: Principal, id: string) {
  requireOperator(p);
  return asSystem(async (tx) => {
    const r = await tx.query<{ customer_id: string | null }>("delete from alert_sources where id = $1 returning customer_id", [id]);
    if (!r.rows[0]) throw notFound("Alert source");
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'monitoring.source_delete', 'alert_source', $3, '{}')",
      [p.userId, r.rows[0].customer_id, id],
    );
    return { ok: true };
  });
}
