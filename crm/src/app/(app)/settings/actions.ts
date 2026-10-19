"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formObject, handleActionError, type ActionState } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { hasRole, type RoleKey } from "@/lib/auth/roles";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { ActionError, requireActionUser } from "@/lib/auth/session";
import { restoreBackup } from "@/lib/backup";
import { db } from "@/lib/db";
import { recomputeScore } from "@/lib/leads/service";
import { SCORING_FACTORS } from "@/lib/scoring";
import { getSetting, setSetting } from "@/lib/settings";

export async function saveSalesSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireActionUser("ADMIN");
    const saved = await setSetting("sales", formObject(fd));
    await audit(user.id, "settings.sales", undefined, saved as unknown as Record<string, unknown>);
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function saveOutreachSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireActionUser("ADMIN");
    const raw = formObject(fd);
    const saved = await setSetting("outreach", { ...raw, mailingAddress: raw.mailingAddress ?? "", signature: raw.signature ?? "", optOutLine: raw.optOutLine ?? "", senderPhone: raw.senderPhone ?? "" });
    await audit(user.id, "settings.outreach", undefined, { mailingAddressSet: !!saved.mailingAddress, dailySendCap: saved.dailySendCap });
    revalidatePath("/outreach");
    revalidatePath("/settings");
    return { ok: true, message: "Saved." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function saveScoringAction(input: { weights: Record<string, number>; coreRegions: string[]; regulatedIndustries: string[] }): Promise<ActionState> {
  try {
    const user = await requireActionUser("ADMIN");
    const weights = Object.fromEntries(SCORING_FACTORS.map((f) => [f.key, Math.max(0, Math.min(100, Math.round(Number(input.weights[f.key] ?? f.defaultMax))))]));
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    if (total !== 100) throw new ActionError(`The weights add up to ${total}. Adjust them to total exactly 100.`);
    await setSetting("scoring", { weights, coreRegions: input.coreRegions, regulatedIndustries: input.regulatedIndustries });
    const ids = await db.company.findMany({ select: { id: true } });
    for (const { id } of ids) await recomputeScore(id);
    await audit(user.id, "settings.scoring", undefined, { weights });
    revalidatePath("/", "layout");
    return { ok: true, message: `Saved and re-scored ${ids.length} prospects.` };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function saveSecuritySettingsAction(input: { requireMfa: boolean; sessionHours: number }): Promise<ActionState> {
  try {
    const user = await requireActionUser("OWNER");
    if (input.requireMfa === false) {
      // Allowed, but recorded.
      await audit(user.id, "settings.mfa_not_required");
    }
    const saved = await setSetting("security", input);
    await audit(user.id, "settings.security", undefined, saved as unknown as Record<string, unknown>);
    revalidatePath("/settings");
    return { ok: true, message: "Saved." };
  } catch (err) {
    return handleActionError(err);
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const ROLE_KEYS = ["OWNER", "ADMIN", "SALES", "VIEWER"] as const;

function assertCanManage(actor: { role: RoleKey }, targetRole: RoleKey) {
  if (targetRole === "OWNER" && actor.role !== "OWNER") throw new ActionError("Only an owner can manage owner accounts.");
}

export async function createUserAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await requireActionUser("ADMIN");
    const input = z
      .object({
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().toLowerCase().email().max(200),
        role: z.enum(ROLE_KEYS),
        password: z.string().min(1).max(200),
      })
      .parse(formObject(fd));
    assertCanManage(actor, input.role);
    const problem = passwordProblem(input.password, input.email);
    if (problem) throw new ActionError(`Temporary password: ${problem}`);
    if (await db.user.findUnique({ where: { email: input.email } })) throw new ActionError("A user with that email already exists.");
    const created = await db.user.create({ data: { name: input.name, email: input.email, role: input.role, passwordHash: await hashPassword(input.password), dailyCallGoal: (await getSetting("sales")).dailyCallGoal } });
    await audit(actor.id, "user.create", { type: "user", id: created.id }, { email: created.email, role: created.role });
    revalidatePath("/settings");
    return { ok: true, message: `${created.name} can now sign in. Share the temporary password privately; they'll set up two-step sign-in on first login.` };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function updateUserAction(id: string, patch: { role?: RoleKey; active?: boolean; resetMfa?: boolean; password?: string }): Promise<ActionState> {
  try {
    const actor = await requireActionUser("ADMIN");
    const target = await db.user.findUniqueOrThrow({ where: { id } });
    assertCanManage(actor, target.role as RoleKey);
    if (patch.role) assertCanManage(actor, patch.role);
    if (id === actor.id && (patch.active === false || (patch.role && !hasRole(patch.role, actor.role)))) {
      throw new ActionError("You can't lower your own role or deactivate yourself.");
    }
    if ((patch.role && patch.role !== "OWNER") || patch.active === false) {
      if (target.role === "OWNER" && (await db.user.count({ where: { role: "OWNER", active: true } })) <= 1) throw new ActionError("Keep at least one active owner.");
    }
    const data: Record<string, unknown> = {};
    if (patch.role) data.role = patch.role;
    if (patch.active !== undefined) data.active = patch.active;
    if (patch.resetMfa) Object.assign(data, { mfaEnabled: false, mfaSecretEnc: null });
    if (patch.password) {
      const problem = passwordProblem(patch.password, target.email);
      if (problem) throw new ActionError(problem);
      Object.assign(data, { passwordHash: await hashPassword(patch.password), failedLogins: 0, lockedUntil: null });
    }
    await db.user.update({ where: { id }, data });
    // Any security change signs the person out everywhere.
    if (patch.active === false || patch.resetMfa || patch.password || patch.role) await db.session.deleteMany({ where: { userId: id } });
    await audit(actor.id, "user.update", { type: "user", id }, { role: patch.role, active: patch.active, resetMfa: patch.resetMfa, passwordReset: !!patch.password });
    revalidatePath("/settings");
    return { ok: true, message: "Updated. They'll need to sign in again." };
  } catch (err) {
    return handleActionError(err);
  }
}

// ---------------------------------------------------------------------------
// Backup restore (append-only)
// ---------------------------------------------------------------------------

export async function restoreBackupAction(fd: FormData): Promise<ActionState> {
  try {
    const user = await requireActionUser("OWNER");
    if (fd.get("confirm") !== "RESTORE") throw new ActionError('Type RESTORE to confirm.');
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) throw new ActionError("Choose a backup file.");
    if (file.size > 4 * 1024 * 1024) throw new ActionError("This backup is larger than 4 MB. Restore it from the command line (see the setup guide).");
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new ActionError("That isn't a Lead Command Center backup file.");
    }
    const result = await restoreBackup(parsed);
    await audit(user.id, "backup.restore", undefined, result as unknown as Record<string, unknown>);
    revalidatePath("/", "layout");
    const added = Object.entries(result.added).filter(([, n]) => n).map(([t, n]) => `${n} ${t}`).join(", ");
    return { ok: true, message: added ? `Restored: ${added}. Existing records were left as they are.` : "Nothing to restore; every record in the backup already exists." };
  } catch (err) {
    return handleActionError(err);
  }
}
