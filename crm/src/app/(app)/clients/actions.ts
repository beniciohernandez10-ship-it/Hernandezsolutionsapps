"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formObject, handleActionError, type ActionState } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { ActionError, requireActionUser } from "@/lib/auth/session";
import { DEFAULT_ONBOARDING_CHECKLIST } from "@/lib/constants";
import { parseLocalDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { changeStage } from "@/lib/leads/service";

const optionalText = (max: number) => z.string().max(max).optional().transform((v) => (v ? v.trim() || null : null));
const SECRET_RE = /(password|passwd|pwd|secret|api[_ -]?key|token)\s*[:=]/i;

const clientSchema = z.object({
  contractStart: z.string().min(1, "Pick the contract start date."),
  renewalDate: z.string().optional(),
  managedUsers: z.coerce.number().int().min(1, "Enter at least 1 managed user.").max(100000),
  monthlyValue: z.coerce.number().min(0).max(10_000_000),
  implementationFee: z.union([z.literal("").transform(() => null), z.coerce.number().min(0).max(10_000_000)]).optional().nullable(),
  primaryContactId: optionalText(60),
  tenantDomain: optionalText(200).refine((v) => !v || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v), "Enter a domain like contoso.onmicrosoft.com"),
  tenantId: optionalText(60).refine((v) => !v || /^[0-9a-f-]{36}$/i.test(v), "A tenant ID is a GUID like 00000000-0000-0000-0000-000000000000"),
  serviceScope: optionalText(5000),
  technicianId: optionalText(60),
});

function dateOnly(v: string | undefined): Date | null {
  if (!v) return null;
  return parseLocalDateTime(`${v.slice(0, 10)}T12:00`);
}

function parseClient(fd: FormData) {
  const input = clientSchema.parse(formObject(fd));
  if (input.serviceScope && SECRET_RE.test(input.serviceScope)) {
    throw new ActionError("That looks like a password or secret. Keep credentials in your password manager, never in the CRM.");
  }
  const contractStart = dateOnly(input.contractStart);
  if (!contractStart) throw new ActionError("Pick a valid contract start date.");
  return { ...input, contractStart, renewalDate: dateOnly(input.renewalDate) };
}

export async function convertToClientAction(companyId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let clientId: string;
  try {
    const user = await requireActionUser("SALES");
    const data = parseClient(fd);
    const existing = await db.client.findUnique({ where: { companyId } });
    if (existing) throw new ActionError("This prospect is already a client.");
    const client = await db.$transaction(async (tx) => {
      const c = await tx.client.create({
        data: { companyId, ...data, onboarding: DEFAULT_ONBOARDING_CHECKLIST.map((label) => ({ label, done: false, doneAt: null })) },
      });
      await changeStage(companyId, "CLOSED_WON", user.id, "Converted to client", tx);
      await tx.activity.create({ data: { companyId, userId: user.id, type: "CONVERTED", summary: "Converted to client", meta: { clientId: c.id, monthlyValue: data.monthlyValue } } });
      await tx.enrollment.updateMany({ where: { companyId, status: { in: ["ACTIVE", "PAUSED"] } }, data: { status: "STOPPED", stopReason: "Became a client", nextStepDueAt: null } });
      await tx.emailMessage.updateMany({ where: { companyId, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "FAILED"] } }, data: { status: "CANCELLED" } });
      await tx.callQueueItem.deleteMany({ where: { companyId, status: "PENDING" } });
      return c;
    });
    clientId = client.id;
    await audit(user.id, "client.convert", { type: "client", id: client.id }, { companyId });
    revalidatePath("/clients");
    revalidatePath(`/leads/${companyId}`);
  } catch (err) {
    return handleActionError(err);
  }
  redirect(`/clients/${clientId}`);
}

export async function updateClientAction(clientId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const data = parseClient(fd);
    await db.client.update({ where: { id: clientId }, data });
    await audit(user.id, "client.update", { type: "client", id: clientId });
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return { ok: true, message: "Saved." };
  } catch (err) {
    return handleActionError(err);
  }
}

type Item = { label: string; done: boolean; doneAt: string | null };

export async function setOnboardingItemAction(clientId: string, index: number, done: boolean): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const client = await db.client.findUniqueOrThrow({ where: { id: clientId } });
    const items = (client.onboarding as Item[]) ?? [];
    if (!items[index]) throw new ActionError("That checklist item no longer exists.");
    items[index] = { ...items[index], done, doneAt: done ? new Date().toISOString() : null };
    await db.client.update({ where: { id: clientId }, data: { onboarding: items } });
    await audit(user.id, "client.onboarding", { type: "client", id: clientId }, { item: items[index].label, done });
    revalidatePath(`/clients/${clientId}`);
    return { ok: true };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function editOnboardingAction(clientId: string, op: { add?: string; remove?: number }): Promise<ActionState> {
  try {
    await requireActionUser("SALES");
    const client = await db.client.findUniqueOrThrow({ where: { id: clientId } });
    let items = (client.onboarding as Item[]) ?? [];
    if (op.add) {
      const label = z.string().trim().min(1).max(200).parse(op.add);
      if (SECRET_RE.test(label)) throw new ActionError("Keep passwords and secrets out of the CRM.");
      items = [...items, { label, done: false, doneAt: null }];
    }
    if (op.remove !== undefined) items = items.filter((_, i) => i !== op.remove);
    await db.client.update({ where: { id: clientId }, data: { onboarding: items } });
    revalidatePath(`/clients/${clientId}`);
    return { ok: true };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function setClientActiveAction(clientId: string, active: boolean): Promise<ActionState> {
  try {
    const user = await requireActionUser("ADMIN");
    await db.client.update({ where: { id: clientId }, data: { active } });
    await audit(user.id, active ? "client.reactivate" : "client.deactivate", { type: "client", id: clientId });
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return { ok: true, message: active ? "Marked active." : "Marked inactive. Its revenue no longer counts as contracted." };
  } catch (err) {
    return handleActionError(err);
  }
}
