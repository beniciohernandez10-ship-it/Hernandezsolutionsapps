"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { formObject, handleActionError, type ActionState } from "@/lib/actions";
import { audit, clientIp } from "@/lib/audit";
import { safeEqual } from "@/lib/crypto";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { verifyTotp } from "@/lib/auth/mfa";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { clearRateLimit, rateLimit } from "@/lib/ratelimit";
import { createSession, destroySession, getCurrentUser } from "@/lib/auth/session";

const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { email, password } = z
      .object({ email: z.string().email().max(200).transform((e) => e.toLowerCase()), password: z.string().min(1).max(200) })
      .parse(formObject(fd));
    const ip = (await clientIp()) ?? "unknown";
    if (!(await rateLimit(`login:ip:${ip}`, 30, 15 * 60)) || !(await rateLimit(`login:email:${email}`, 10, 15 * 60))) {
      return { ok: false, error: "Too many sign-in attempts. Wait 15 minutes and try again." };
    }
    const user = await db.user.findUnique({ where: { email } });
    if (!user || !user.active) {
      await burnPasswordCheck(password);
      return { ok: false, error: "That email and password don't match." };
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return { ok: false, error: "This account is temporarily locked after too many attempts. Try again later." };
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      const failed = user.failedLogins + 1;
      await db.user.update({
        where: { id: user.id },
        data: { failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      });
      await audit(user.id, "auth.login_failed");
      return { ok: false, error: "That email and password don't match." };
    }
    await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: user.mfaEnabled ? undefined : new Date() } });
    await clearRateLimit(`login:email:${email}`);
    await createSession(user.id, !user.mfaEnabled);
    await audit(user.id, user.mfaEnabled ? "auth.password_ok" : "auth.login");
  } catch (err) {
    return handleActionError(err);
  }
  redirect("/login/mfa");
}

export async function mfaAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    if (!user.mfaEnabled || user.mfaVerified) redirect("/");
    if (!(await rateLimit(`mfa:${user.id}`, 6, 5 * 60))) return { ok: false, error: "Too many codes tried. Wait 5 minutes." };
    const code = String(fd.get("code") ?? "");
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!row.mfaSecretEnc || !(await verifyTotp(decrypt(row.mfaSecretEnc), code))) {
      await audit(user.id, "auth.mfa_failed");
      return { ok: false, error: "That code didn't work. Check your authenticator app and try again." };
    }
    await db.session.update({ where: { id: user.sessionId }, data: { mfaVerified: true } });
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit(user.id, "auth.login");
  } catch (err) {
    return handleActionError(err);
  }
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  await destroySession();
  if (user) await audit(user.id, "auth.logout");
  redirect("/login");
}

/** First-run owner account. Works only while there are no users and SETUP_TOKEN matches. */
export async function setupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const expected = process.env.SETUP_TOKEN;
    if (!expected || expected.length < 16) return { ok: false, error: "Set a SETUP_TOKEN of at least 16 characters in the environment first." };
    const ip = (await clientIp()) ?? "unknown";
    if (!(await rateLimit(`setup:${ip}`, 10, 15 * 60))) return { ok: false, error: "Too many attempts. Wait 15 minutes." };
    const input = z
      .object({
        token: z.string().min(1),
        name: z.string().min(1).max(120),
        email: z.string().email().max(200).transform((e) => e.toLowerCase()),
        password: z.string().min(1).max(200),
      })
      .parse(formObject(fd));
    if (!safeEqual(input.token, expected)) return { ok: false, error: "The setup token doesn't match." };
    if ((await db.user.count()) > 0) return { ok: false, error: "Setup is already finished. Sign in instead." };
    const problem = passwordProblem(input.password, input.email);
    if (problem) return { ok: false, error: problem };
    const user = await db.user.create({
      data: { name: input.name, email: input.email, passwordHash: await hashPassword(input.password), role: "OWNER" },
    });
    await audit(user.id, "auth.setup_owner");
    await createSession(user.id, true);
  } catch (err) {
    return handleActionError(err);
  }
  redirect("/account?setup=mfa");
}
