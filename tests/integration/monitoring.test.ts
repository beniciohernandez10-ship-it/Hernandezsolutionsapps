import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem } from "@/lib/db";
import { getTicket, updateTicket } from "@/lib/tickets/service";
import { saveRule } from "@/lib/productivity/service";
import {
  MONITORING_USER,
  createAlertSource,
  ingestAlert,
  listAlerts,
  rotateAlertSource,
  runMonitoringChecks,
  saveMonitorSettings,
} from "@/lib/monitoring/service";

const U = DEMO.users;
const C = DEMO.customers.contoso;
const F = DEMO.customers.fabrikam;

const alertFor = async (fingerprint: string) =>
  (await asSystem((tx) => tx.query<Record<string, unknown>>("select * from monitor_alerts where fingerprint = $1 order by first_seen_at desc", [fingerprint]))).rows;

async function intuneDevice(customerId: string, name: string, compliance: string, lastSync = new Date()) {
  const r = await asSystem((tx) =>
    tx.query<{ id: string }>(
      "insert into devices (customer_id, source, intune_managed_device_id, name, compliance_state, last_provider_sync_at) values ($1, 'intune', $2, $3, $4, $5) returning id",
      [customerId, randomUUID(), name, compliance, lastSync.toISOString()],
    ),
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  await freshDatabase();
});

describe("built-in checks", () => {
  it("a non-compliant device opens one ticket, repeats don't duplicate it, and it resolves itself when fixed", async () => {
    const id = await intuneDevice(C, "CD-RECEPTION-07", "noncompliant");
    await runMonitoringChecks();
    const [a] = await alertFor(`intune:noncompliant:${id}`);
    expect(a).toMatchObject({ status: "open", severity: "warning", occurrences: 1 });
    const tech = await principal(U.tech);
    const t = await getTicket(tech, a.ticket_id as string);
    expect(t).toMatchObject({ title: "CD-RECEPTION-07 is not compliant in Intune", priority: "normal", category: "security", requesterName: "IT Center Monitoring" });
    expect(t.devices.map((d) => d.id)).toEqual([id]);

    await runMonitoringChecks();
    const again = await alertFor(`intune:noncompliant:${id}`);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ occurrences: 2, ticket_id: a.ticket_id });

    await asSystem((tx) => tx.query("update devices set compliance_state = 'compliant' where id = $1", [id]));
    await runMonitoringChecks();
    expect((await alertFor(`intune:noncompliant:${id}`))[0]).toMatchObject({ status: "resolved" });
    const after = await getTicket(tech, a.ticket_id as string);
    expect(after.status).toBe("resolved");
    expect(after.resolutionNote).toContain("Cleared automatically");
    expect(after.messages.at(-1)).toMatchObject({ visibility: "internal" });
  });

  it("once a technician has picked it up, clearing only adds a note", async () => {
    const id = await intuneDevice(C, "CD-OPS-02", "error");
    await runMonitoringChecks();
    const [a] = await alertFor(`intune:noncompliant:${id}`);
    const tech = await principal(U.tech);
    const t = await getTicket(tech, a.ticket_id as string);
    await updateTicket(tech, t.id, { expectedVersion: t.version, assigneeUserId: U.tech });
    await asSystem((tx) => tx.query("update devices set removed_at = now() where id = $1", [id]));
    await runMonitoringChecks();
    const after = await getTicket(tech, t.id);
    expect(after.status).toBe("open");
    expect(after.messages.at(-1)?.body).toContain("alert cleared");
  });

  it("stale devices, ending warranties and license shortages follow each client's settings", async () => {
    const stale = await intuneDevice(F, "FAB-OLD-01", "compliant", new Date(Date.now() - 20 * 864e5));
    const asset = await asSystem(async (tx) => {
      const n = (await tx.query<{ n: number }>("select app_next_asset_number($1, 'laptop') as n", [C])).rows[0].n;
      return (
        await tx.query<{ id: string }>(
          "insert into assets (customer_id, kind, number, tag, short_code, warranty_expires) values ($1, 'laptop', $2, $3, $4, current_date + 10) returning id",
          [C, n, `LAPTOP-${String(n).padStart(3, "0")}`, "abcdefghjk"],
        )
      ).rows[0].id;
    });
    await asSystem((tx) =>
      tx.query("insert into license_inventory (customer_id, sku_id, sku_part_number, enabled, consumed) values ($1, $2, 'O365_BUSINESS_PREMIUM', 10, 10)", [C, randomUUID()]),
    );
    await runMonitoringChecks();
    expect((await alertFor(`device:stale:${stale}`))[0]).toMatchObject({ status: "open", severity: "warning" });
    const w = (await asSystem((tx) => tx.query<Record<string, unknown>>("select * from monitor_alerts where source = 'warranty' and asset_id = $1", [asset]))).rows[0];
    expect(w).toMatchObject({ status: "open", severity: "info" });
    const lic = (await asSystem((tx) => tx.query<Record<string, unknown>>("select * from monitor_alerts where source = 'licenses' and customer_id = $1", [C]))).rows[0];
    expect(lic.title).toBe("No spare O365_BUSINESS_PREMIUM licenses");

    // Turning the stale check off for Fabrikam clears its alert.
    await saveMonitorSettings(await principal(U.operator), F, { intuneCompliance: true, staleDeviceDays: 0, warrantyDays: 30, licenseShortage: true });
    await runMonitoringChecks();
    expect((await alertFor(`device:stale:${stale}`))[0].status).toBe("resolved");

    // An extended warranty clears the alert but leaves its ticket for a person to close.
    await asSystem((tx) => tx.query("update assets set warranty_expires = current_date + 400 where id = $1", [asset]));
    await runMonitoringChecks();
    const wt = await getTicket(await principal(U.tech), w.ticket_id as string);
    expect(wt.status).toBe("open");
    await expectAppError(saveMonitorSettings(await principal(U.manager), C, { intuneCompliance: false, staleDeviceDays: 0, warrantyDays: 0, licenseShortage: false }), 403);
  });

  it("assignment rules apply to monitoring tickets", async () => {
    const op = await principal(U.operator);
    await saveRule(op, null, {
      name: "Security to Tess", customerId: C, active: true, position: 1, matchCategory: "security", matchPriority: null, matchKind: null, matchKeyword: null,
      assignUserId: U.tech, assignQueueId: null,
    });
    const id = await intuneDevice(C, "CD-FRONT-09", "noncompliant");
    await runMonitoringChecks();
    const [a] = await alertFor(`intune:noncompliant:${id}`);
    expect((await getTicket(await principal(U.tech), a.ticket_id as string)).assigneeUserId).toBe(U.tech);
  });
});

describe("external alerts", () => {
  it("authenticates by token, opens on the source's threshold, updates repeats and clears", async () => {
    const op = await principal(U.operator);
    const { id, token } = await createAlertSource(op, { name: "Uptime monitor", customerId: C, minSeverity: "warning", autoResolve: true });
    await expectAppError(ingestAlert(id, "wrong", { id: "x", title: "x" }), 401);
    // Even an invalid alert gets 401, not a validation error, without the right token.
    await expectAppError(ingestAlert(id, "wrong", {}), 401);
    await expectAppError(ingestAlert(randomUUID(), token, { id: "x", title: "x" }), 401);

    expect(await ingestAlert(id, token, { id: "web-1", title: "Website down", severity: "critical", device: "CD-RECEPTION-07" })).toEqual({ status: "opened", ticket: true });
    const [a] = await alertFor(`webhook:${id}:web-1`);
    const t = await getTicket(await principal(U.tech), a.ticket_id as string);
    expect(t).toMatchObject({ priority: "high", title: "Website down" });
    expect(t.description).toContain("Source: Uptime monitor");

    expect(await ingestAlert(id, token, { id: "web-1", title: "Website down", severity: "high" })).toEqual({ status: "updated", ticket: true });
    expect(await ingestAlert(id, token, { id: "web-1", title: "Website down", status: "resolved" })).toEqual({ status: "cleared" });
    expect((await getTicket(await principal(U.tech), t.id)).status).toBe("resolved");

    // Below the threshold: recorded, no ticket.
    expect(await ingestAlert(id, token, { id: "disk-1", title: "Disk 80% full", severity: "info" })).toEqual({ status: "opened", ticket: false });

    // A rotated token replaces the old one.
    const rotated = await rotateAlertSource(op, id);
    await expectAppError(ingestAlert(id, token, { id: "y", title: "y" }), 401);
    expect((await ingestAlert(id, rotated.token, { id: "y", title: "y", severity: "warning" })).status).toBe("opened");
  });

  it("a multi-client source needs a mapped Atera customer ID", async () => {
    const { id, token } = await createAlertSource(await principal(U.operator), { name: "Atera alerts", customerId: null });
    await expectAppError(ingestAlert(id, token, { id: "1", title: "CPU high" }), 422);
    await expectAppError(ingestAlert(id, token, { id: "1", title: "CPU high", ateraCustomerId: 999999 }), 422);
  });

  it("technicians see their clients' alerts; others don't", async () => {
    const mine = await listAlerts(await principal(U.tech));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((a) => a.customerId === C)).toBe(true);
    expect((await listAlerts(await principal(U.techFabrikam), { status: "resolved" })).every((a) => a.customerId === F)).toBe(true);
    await expectAppError(listAlerts(await principal(U.contosoAdmin)), 403);
    // The monitoring account is never a person: no sign-in identity, no memberships.
    const m = await asSystem((tx) => tx.query("select 1 from memberships where user_id = $1", [MONITORING_USER]));
    expect(m.rows).toHaveLength(0);
  });
});
