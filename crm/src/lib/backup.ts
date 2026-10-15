import { db } from "./db";

/**
 * JSON backups of business data. Sessions, rate limits, password hashes and MFA secrets are
 * never included. Restore is append-only: records whose id already exists are skipped, so a
 * restore can't overwrite or delete anything.
 */

export const BACKUP_VERSION = 1;

// Order matters for restore (parents first).
const TABLES = [
  "setting", "template", "sequence", "sequenceStep", "company", "contact", "activity", "task", "callQueueItem",
  "enrollment", "emailMessage", "researchFinding", "client", "savedView",
] as const;
type Table = (typeof TABLES)[number];

export async function createBackup() {
  const [users, ...rows] = await Promise.all([
    db.user.findMany({ select: { id: true, email: true, name: true, role: true, active: true, dailyCallGoal: true, createdAt: true } }),
    db.setting.findMany(),
    db.template.findMany(),
    db.sequence.findMany(),
    db.sequenceStep.findMany(),
    db.company.findMany(),
    db.contact.findMany(),
    db.activity.findMany(),
    db.task.findMany(),
    db.callQueueItem.findMany(),
    db.enrollment.findMany(),
    db.emailMessage.findMany(),
    db.researchFinding.findMany(),
    db.client.findMany(),
    db.savedView.findMany(),
  ]);
  const data = Object.fromEntries(TABLES.map((t, i) => [t, rows[i]]));
  const attachments = await db.attachment.findMany({ select: { id: true, companyId: true, fileName: true, mimeType: true, size: true, uploadedBy: true, createdAt: true, data: true } });
  return {
    app: "hs-lead-command-center",
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    // Users are listed for reference only; accounts are never restored from a file.
    users,
    data: { ...data, attachment: attachments.map((a) => ({ ...a, data: Buffer.from(a.data).toString("base64") })) },
  };
}

const DATE_KEYS = /At$|Date$|^contractStart$|^dueAt$|^occurredAt$|^discoveredAt$|^retrievedAt$|^stageChangedAt$|^lastVerifiedAt$|^nextFollowUpAt$|^nextStepDueAt$|^expectedCloseDate$|^lastContactedAt$/;

function revive(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === "string" && DATE_KEYS.test(k) && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : v;
  return out;
}

export async function restoreBackup(raw: unknown): Promise<{ added: Record<string, number> }> {
  const b = raw as { app?: string; version?: number; data?: Record<string, Record<string, unknown>[]> };
  if (b?.app !== "hs-lead-command-center" || !b.data) throw new Error("That isn't a Lead Command Center backup file.");
  if ((b.version ?? 0) > BACKUP_VERSION) throw new Error("This backup is from a newer version of the app.");
  const userIds = new Set((await db.user.findMany({ select: { id: true } })).map((u) => u.id));
  const added: Record<string, number> = {};
  const userFields = ["ownerId", "userId", "assigneeId", "createdById", "approvedById", "technicianId", "uploadedBy"];
  for (const table of [...TABLES, "attachment"] as (Table | "attachment")[]) {
    const rows = b.data[table] ?? [];
    if (!rows.length) continue;
    const prepared = rows.map((r) => {
      const row = revive(r);
      // People who no longer exist here are cleared rather than failing the restore.
      for (const f of userFields) if (row[f] && !userIds.has(String(row[f]))) row[f] = f === "userId" && table === "savedView" ? undefined : null;
      if (table === "attachment" && typeof row.data === "string") row.data = Buffer.from(row.data, "base64");
      return row;
    }).filter((r) => !(table === "savedView" && !r.userId) && !(table === "callQueueItem" && !userIds.has(String(r.userId))));
    const delegate = (db as unknown as Record<string, { createMany: (a: { data: unknown[]; skipDuplicates: boolean }) => Promise<{ count: number }> }>)[table === "setting" ? "setting" : table];
    const res = await delegate.createMany({ data: prepared, skipDuplicates: true });
    added[table] = res.count;
  }
  return { added };
}
