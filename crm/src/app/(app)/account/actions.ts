"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formObject, handleActionError, type ActionState } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { mfaQrDataUrl, newMfaSecret, verifyTotp } from "@/lib/auth/mfa";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { ActionError, getCurrentUser } from "@/lib/auth/session";
import { decrypt, encrypt, randomToken, sha256 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { getSetting } from "@/lib/settings";

/** Account actions are allowed before MFA is set up (that's how it gets set up). */
async function accountUser() {
  const user = await getCurrentUser();
  if (!user || (user.mfaEnabled && !user.mfaVerified)) throw new ActionError("Your session ended. Sign in again.");
  return user;
}

export async function startMfaSetupAction(): Promise<ActionState> {
  try {
    const user = await accountUser();
    if (user.mfaEnabled) throw new ActionError("Two-step sign-in is already on.");
    const secret = newMfaSecret();
    await db.user.update({ where: { id: user.id }, data: { mfaSecretEnc: encrypt(secret) } });
    return { ok: true, data: { qr: await mfaQrDataUrl(user.email, secret), secret } };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function confirmMfaAction(code: string): Promise<ActionState> {
  try {
    const user = await accountUser();
    if (!(await rateLimit(`mfa-setup:${user.id}`, 10, 5 * 60))) throw new ActionError("Too many tries. Wait 5 minutes.");
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!row.mfaSecretEnc) throw new ActionError("Start setup again.");
    if (!verifyTotp(decrypt(row.mfaSecretEnc), code)) throw new ActionError("That code didn't match. Check the time on your phone and try the newest code.");
    await db.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    await db.session.update({ where: { id: user.sessionId }, data: { mfaVerified: true } });
    await db.session.deleteMany({ where: { userId: user.id, id: { not: user.sessionId } } });
    await audit(user.id, "auth.mfa_enabled");
    revalidatePath("/account");
    return { ok: true, message: "Two-step sign-in is on." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function disableMfaAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await accountUser();
    if ((await getSetting("security")).requireMfa) throw new ActionError("Your workspace requires two-step sign-in, so it can't be turned off.");
    const { password, code } = z.object({ password: z.string().min(1), code: z.string().min(6) }).parse(formObject(fd));
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(password, row.passwordHash)) || !row.mfaSecretEnc || !verifyTotp(decrypt(row.mfaSecretEnc), code)) {
      throw new ActionError("Password or code didn't match.");
    }
    await db.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecretEnc: null } });
    await audit(user.id, "auth.mfa_disabled");
    revalidatePath("/account");
    return { ok: true, message: "Two-step sign-in is off." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await accountUser();
    if (!(await rateLimit(`pw-change:${user.id}`, 10, 15 * 60))) throw new ActionError("Too many attempts. Wait 15 minutes.");
    const input = z.object({ current: z.string().min(1, "Enter your current password."), next: z.string().min(1), confirm: z.string().min(1) }).parse(formObject(fd));
    if (input.next !== input.confirm) throw new ActionError("The new passwords don't match.");
    const problem = passwordProblem(input.next, user.email);
    if (problem) throw new ActionError(problem);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(input.current, row.passwordHash))) throw new ActionError("Your current password isn't right.");
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.next) } });
    await db.session.deleteMany({ where: { userId: user.id, id: { not: user.sessionId } } });
    await audit(user.id, "auth.password_changed");
    return { ok: true, message: "Password changed. Other devices were signed out." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function updateProfileAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await accountUser();
    const { name } = z.object({ name: z.string().trim().min(1).max(120) }).parse(formObject(fd));
    await db.user.update({ where: { id: user.id }, data: { name } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved." };
  } catch (err) {
    return handleActionError(err);
  }
}

/** Create a new private calendar link. The full link is shown once; only its hash is stored. */
export async function rotateCalendarTokenAction(): Promise<ActionState> {
  try {
    const user = await accountUser();
    const token = randomToken(24);
    await db.user.update({ where: { id: user.id }, data: { calendarToken: sha256(token) } });
    await audit(user.id, "calendar.rotate");
    revalidatePath("/account");
    return { ok: true, data: { token } };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function revokeCalendarTokenAction(): Promise<ActionState> {
  try {
    const user = await accountUser();
    await db.user.update({ where: { id: user.id }, data: { calendarToken: null } });
    await audit(user.id, "calendar.revoke");
    revalidatePath("/account");
    return { ok: true, message: "Calendar link turned off." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function signOutOtherSessionsAction(): Promise<ActionState> {
  try {
    const user = await accountUser();
    const r = await db.session.deleteMany({ where: { userId: user.id, id: { not: user.sessionId } } });
    await audit(user.id, "auth.signout_others", undefined, { count: r.count });
    revalidatePath("/account");
    return { ok: true, message: `Signed out ${r.count} other session${r.count === 1 ? "" : "s"}.` };
  } catch (err) {
    return handleActionError(err);
  }
}
