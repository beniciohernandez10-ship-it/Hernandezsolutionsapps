"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { handleActionError, type ActionState } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { ActionError, requireActionUser } from "@/lib/auth/session";
import { stageAfterCall } from "@/lib/calls";
import { CALL_OUTCOMES, CALL_OUTCOME_LABEL, TASK_TYPE_LABEL, type CallOutcomeKey } from "@/lib/constants";
import { dayKey, nextWorkday, parseLocalDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { changeStage, recomputeScore, syncNextFollowUp } from "@/lib/leads/service";
import { normalizePhone } from "@/lib/normalize";
import { buildQueue } from "@/lib/queue";

const logCallSchema = z.object({
  companyId: z.string().min(1),
  contactId: z.string().optional().nullable(),
  queueItemId: z.string().optional().nullable(),
  outcome: z.enum(CALL_OUTCOMES.map((o) => o.key) as [CallOutcomeKey, ...CallOutcomeKey[]]),
  durationSec: z.number().int().min(0).max(4 * 3600).optional().nullable(),
  notes: z.string().max(10000).optional().nullable(),
  phoneDialed: z.string().max(40).optional().nullable(),
  followUp: z
    .object({ type: z.enum(["CALLBACK", "EMAIL", "MEETING", "PROPOSAL", "CONTRACT", "REENGAGE", "OTHER"]), dueLocal: z.string().min(1), notes: z.string().max(2000).optional() })
    .optional()
    .nullable(),
});

export async function logCallAction(raw: z.input<typeof logCallSchema>): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const input = logCallSchema.parse(raw);
    const company = await db.company.findUniqueOrThrow({ where: { id: input.companyId } });
    const dueAt = input.followUp ? parseLocalDateTime(input.followUp.dueLocal) : null;
    if (input.followUp && !dueAt) throw new ActionError("Pick a valid follow-up date and time.");

    let stageNote = "";
    await db.$transaction(async (tx) => {
      await tx.activity.create({
        data: {
          companyId: company.id,
          contactId: input.contactId || null,
          userId: user.id,
          type: "CALL",
          callOutcome: input.outcome,
          durationSec: input.durationSec ?? null,
          summary: `Call: ${CALL_OUTCOME_LABEL[input.outcome]}`,
          body: input.notes || null,
          meta: input.phoneDialed ? { phone: input.phoneDialed } : undefined,
        },
      });
      await tx.company.update({ where: { id: company.id }, data: { callCount: { increment: 1 }, lastContactedAt: new Date() } });

      if (input.outcome === "WRONG_NUMBER" && input.phoneDialed) {
        const dialed = normalizePhone(input.phoneDialed);
        if (dialed && dialed === company.normalizedPhone) await tx.company.update({ where: { id: company.id }, data: { mainPhoneStatus: "INVALID" } });
        if (dialed && input.contactId) {
          const c = await tx.contact.findUnique({ where: { id: input.contactId } });
          if (c && normalizePhone(c.phone) === dialed) await tx.contact.update({ where: { id: c.id }, data: { phoneStatus: "INVALID" } });
        }
      }
      if (input.outcome === "SPOKE_WITH_DECISION_MAKER" && input.contactId) {
        await tx.contact.update({ where: { id: input.contactId }, data: { isDecisionMaker: true } });
      }

      const next = stageAfterCall(company.stage, input.outcome);
      if (next && (await changeStage(company.id, next, user.id, `After call: ${CALL_OUTCOME_LABEL[input.outcome]}`, tx))) stageNote = next;

      // This call closes any callback that was due by now (before the new follow-up is added).
      await tx.task.updateMany({
        where: { companyId: company.id, type: "CALLBACK", completedAt: null, dueAt: { lte: new Date(Date.now() + 12 * 3600_000) } },
        data: { completedAt: new Date() },
      });
      if (input.followUp && dueAt) {
        const t = await tx.task.create({
          data: {
            companyId: company.id,
            contactId: input.contactId || null,
            assigneeId: user.id,
            type: input.followUp.type,
            title: TASK_TYPE_LABEL[input.followUp.type],
            dueAt,
            notes: input.followUp.notes || null,
          },
        });
        await tx.activity.create({
          data: { companyId: company.id, userId: user.id, type: "FOLLOW_UP_CREATED", summary: `${TASK_TYPE_LABEL[input.followUp.type]} scheduled`, meta: { taskId: t.id, dueAt: dueAt.toISOString() } },
        });
      }
      await syncNextFollowUp(company.id, tx);

      if (input.queueItemId) {
        await tx.callQueueItem.update({ where: { id: input.queueItemId }, data: { status: "DONE", outcome: input.outcome, completedAt: new Date() } });
      }
    });
    if (input.outcome === "WRONG_NUMBER" || input.outcome === "SPOKE_WITH_DECISION_MAKER") await recomputeScore(company.id);
    await audit(user.id, "call.log", { type: "company", id: company.id }, { outcome: input.outcome });
    revalidatePath("/calls");
    revalidatePath(`/leads/${company.id}`);
    return { ok: true, message: `Call logged${stageNote ? " and stage updated" : ""}.`, data: { stage: stageNote || company.stage } };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function skipQueueItemAction(id: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    await db.callQueueItem.update({ where: { id, userId: user.id }, data: { status: "SKIPPED", completedAt: new Date() } });
    revalidatePath("/calls");
    return { ok: true, message: "Skipped. It stays in your prospect list." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function restoreQueueItemAction(id: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    await db.callQueueItem.update({ where: { id, userId: user.id }, data: { status: "PENDING", completedAt: null, outcome: null } });
    revalidatePath("/calls");
    return { ok: true };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function removeQueueItemAction(id: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    await db.callQueueItem.delete({ where: { id, userId: user.id } });
    revalidatePath("/calls");
    return { ok: true, message: "Removed from the queue." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function addToQueueAction(companyId: string, day?: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const d = day ?? dayKey();
    const max = await db.callQueueItem.aggregate({ where: { userId: user.id, day: d }, _max: { position: true } });
    await db.callQueueItem.upsert({
      where: { day_userId_companyId: { day: d, userId: user.id, companyId } },
      create: { day: d, userId: user.id, companyId, position: (max._max.position ?? 0) + 1, reason: "Added by hand" },
      update: { status: "PENDING", completedAt: null, outcome: null },
    });
    revalidatePath("/calls");
    return { ok: true, message: d === dayKey() ? "Added to today's calls." : "Added to the call queue." };
  } catch (err) {
    return handleActionError(err);
  }
}

/** Build (or top up) a day's queue from priority, past attempts and follow-up dates. */
export async function generateQueueAction(which: "today" | "tomorrow", replace = false): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const today = dayKey();
    const day = which === "today" ? today : nextWorkday(today);
    const result = await buildQueue({ userId: user.id, day, replace });
    await audit(user.id, "queue.generate", undefined, { day, added: result.added });
    revalidatePath("/calls");
    if (!result.added && !result.existing) return { ok: true, message: "No prospects with a phone number are ready to call. Add phone numbers or import more leads." };
    return { ok: true, message: `${which === "today" ? "Today's" : "Tomorrow's"} queue has ${result.added + result.existing} calls (${result.added} added).`, data: { day } };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function setDailyGoalAction(goal: number): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const g = z.number().int().min(1).max(200).parse(goal);
    await db.user.update({ where: { id: user.id }, data: { dailyCallGoal: g } });
    revalidatePath("/calls");
    return { ok: true, message: `Daily goal set to ${g} calls.` };
  } catch (err) {
    return handleActionError(err);
  }
}
