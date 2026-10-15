"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { handleActionError, type ActionState } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { ActionError, requireActionUser } from "@/lib/auth/session";
import { INDUSTRIES } from "@/lib/constants";
import { db } from "@/lib/db";
import { advanceEnrollments, approveAndSend, markSentManually, recipientFor } from "@/lib/outreach";

function refresh(companyId?: string) {
  revalidatePath("/outreach");
  revalidatePath("/");
  if (companyId) revalidatePath(`/leads/${companyId}`);
}

// ---------------------------------------------------------------------------
// Single emails
// ---------------------------------------------------------------------------

const draftSchema = z.object({
  id: z.string().optional().nullable(),
  companyId: z.string().min(1),
  contactId: z.string().optional().nullable(),
  toEmail: z.string().trim().email("Enter a valid recipient email.").max(320),
  subject: z.string().trim().min(1, "Add a subject.").max(300),
  body: z.string().trim().min(1, "Write the email first.").max(20000),
  templateId: z.string().optional().nullable(),
  status: z.enum(["DRAFT", "PENDING_APPROVAL"]),
});

/** Save a draft or put it in the approval queue. Returns the email id. */
export async function saveEmailAction(raw: z.input<typeof draftSchema>): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const input = draftSchema.parse(raw);
    const data = {
      companyId: input.companyId,
      contactId: input.contactId || null,
      toEmail: input.toEmail,
      subject: input.subject,
      body: input.body,
      templateId: input.templateId || null,
      status: input.status,
    };
    let id = input.id ?? null;
    if (id) {
      const existing = await db.emailMessage.findUnique({ where: { id }, select: { status: true } });
      if (!existing) throw new ActionError("That email no longer exists.");
      if (["SENT", "SENDING"].includes(existing.status)) throw new ActionError("This email was already sent and can't be edited.");
      await db.emailMessage.update({ where: { id }, data: { ...data, error: null } });
    } else {
      id = (await db.emailMessage.create({ data: { ...data, createdById: user.id } })).id;
    }
    refresh(input.companyId);
    return { ok: true, message: input.status === "DRAFT" ? "Draft saved." : "Added to the approval queue.", data: { id } };
  } catch (err) {
    return handleActionError(err);
  }
}

/** Approve and send right now. This is the only path that sends through Gmail or Microsoft 365. */
export async function sendEmailAction(id: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const r = await approveAndSend(id, user.id);
    const email = await db.emailMessage.findUnique({ where: { id }, select: { companyId: true, toEmail: true } });
    refresh(email?.companyId);
    if (!r.ok) return { ok: false, error: r.error };
    await audit(user.id, "email.send", { type: "email", id }, { via: r.via, to: email?.toEmail });
    return { ok: true, message: `Sent to ${email?.toEmail}.` };
  } catch (err) {
    return handleActionError(err);
  }
}

/** Approve and send the selected emails one by one. Stops at the first sending-limit or connection error. */
export async function sendManyAction(ids: string[]): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const list = z.array(z.string()).min(1).max(100).parse(ids);
    let sent = 0;
    const failures: string[] = [];
    for (const id of list) {
      const r = await approveAndSend(id, user.id);
      if (r.ok) sent++;
      else {
        failures.push(r.error);
        if (/limit|connected|Microsoft sign-in|mailing address/i.test(r.error)) break;
      }
    }
    await audit(user.id, "email.send_bulk", undefined, { requested: list.length, sent });
    refresh();
    if (!failures.length) return { ok: true, message: `Sent ${sent} email${sent === 1 ? "" : "s"}.` };
    return { ok: sent > 0, error: `Sent ${sent} of ${list.length}. ${failures[0]}` };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function markSentAction(id: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const r = await markSentManually(id, user.id);
    const email = await db.emailMessage.findUnique({ where: { id }, select: { companyId: true } });
    refresh(email?.companyId);
    if (!r.ok) return { ok: false, error: r.error };
    await audit(user.id, "email.mark_sent", { type: "email", id });
    return { ok: true, message: "Marked as sent and added to the timeline." };
  } catch (err) {
    return handleActionError(err);
  }
}

/** Cancel an email. A cancelled sequence email pauses its sequence so nothing else is drafted. */
export async function cancelEmailAction(id: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const email = await db.emailMessage.findUniqueOrThrow({ where: { id } });
    if (["SENT", "SENDING"].includes(email.status)) throw new ActionError("This email was already sent.");
    await db.$transaction(async (tx) => {
      await tx.emailMessage.update({ where: { id }, data: { status: "CANCELLED" } });
      if (email.enrollmentId) {
        await tx.enrollment.updateMany({ where: { id: email.enrollmentId, status: "ACTIVE" }, data: { status: "PAUSED", stopReason: "A step was cancelled", nextStepDueAt: null } });
      }
    });
    await audit(user.id, "email.cancel", { type: "email", id });
    refresh(email.companyId);
    return { ok: true, message: email.enrollmentId ? "Cancelled. Its sequence is paused; resume it from Sequences." : "Cancelled." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function deleteEmailAction(id: string): Promise<ActionState> {
  try {
    await requireActionUser("SALES");
    const email = await db.emailMessage.findUniqueOrThrow({ where: { id }, select: { status: true, companyId: true } });
    if (!["DRAFT", "CANCELLED", "FAILED"].includes(email.status)) throw new ActionError("Only drafts, cancelled and failed emails can be deleted.");
    await db.emailMessage.delete({ where: { id } });
    refresh(email.companyId);
    return { ok: true, message: "Deleted." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function runSequencesAction(): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const r = await advanceEnrollments();
    await audit(user.id, "sequences.run", undefined, r as unknown as Record<string, unknown>);
    refresh();
    return { ok: true, message: r.drafted ? `${r.drafted} follow-up${r.drafted === 1 ? "" : "s"} drafted for your approval.` : "No follow-ups are due yet." };
  } catch (err) {
    return handleActionError(err);
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const industryKeys = INDUSTRIES.map((i) => i.key) as string[];
const templateSchema = z.object({
  name: z.string().trim().min(1, "Name the template.").max(120),
  channel: z.enum(["EMAIL", "CALL_SCRIPT"]),
  industries: z.array(z.string()).max(40).transform((l) => l.filter((k) => industryKeys.includes(k))),
  subject: z.string().max(300).default(""),
  body: z.string().trim().min(1, "Write the template body.").max(20000),
  active: z.boolean().default(true),
});

export async function saveTemplateAction(id: string | null, raw: z.input<typeof templateSchema>): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const input = templateSchema.parse(raw);
    if (input.channel === "EMAIL" && !input.subject.trim()) throw new ActionError("Email templates need a subject.");
    const saved = id
      ? await db.template.update({ where: { id }, data: { ...input, edited: true } })
      : await db.template.create({ data: input });
    await audit(user.id, id ? "template.update" : "template.create", { type: "template", id: saved.id }, { name: saved.name });
    revalidatePath("/outreach/templates");
    return { ok: true, message: "Template saved.", data: { id: saved.id } };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function deleteTemplateAction(id: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("ADMIN");
    const t = await db.template.findUniqueOrThrow({ where: { id } });
    if (t.builtInKey) {
      await db.template.update({ where: { id }, data: { active: false } });
      revalidatePath("/outreach/templates");
      return { ok: true, message: "Built-in templates can't be deleted, so this one is now turned off." };
    }
    await db.template.delete({ where: { id } });
    await audit(user.id, "template.delete", { type: "template", id }, { name: t.name });
    revalidatePath("/outreach/templates");
    return { ok: true, message: "Template deleted." };
  } catch (err) {
    return handleActionError(err);
  }
}

// ---------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------

const sequenceSchema = z.object({
  name: z.string().trim().min(1, "Name the sequence.").max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  active: z.boolean().default(true),
  steps: z
    .array(z.object({ delayDays: z.coerce.number().int().min(0).max(90), templateId: z.string().optional().nullable(), sameThread: z.boolean().default(true) }))
    .min(1, "Add at least one email.")
    .max(10),
});

export async function saveSequenceAction(id: string | null, raw: z.input<typeof sequenceSchema>): Promise<ActionState> {
  try {
    const user = await requireActionUser("ADMIN");
    const input = sequenceSchema.parse(raw);
    const steps = input.steps.map((s, i) => ({ order: i + 1, delayDays: s.delayDays, templateId: s.templateId || null, sameThread: i === 0 ? false : s.sameThread }));
    const saved = await db.$transaction(async (tx) => {
      if (id) {
        await tx.sequenceStep.deleteMany({ where: { sequenceId: id } });
        return tx.sequence.update({ where: { id }, data: { name: input.name, description: input.description || null, active: input.active, steps: { create: steps } } });
      }
      return tx.sequence.create({ data: { name: input.name, description: input.description || null, active: input.active, steps: { create: steps } } });
    });
    await audit(user.id, id ? "sequence.update" : "sequence.create", { type: "sequence", id: saved.id }, { name: saved.name });
    revalidatePath("/outreach/sequences");
    return { ok: true, message: "Sequence saved.", data: { id: saved.id } };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function deleteSequenceAction(id: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("ADMIN");
    const active = await db.enrollment.count({ where: { sequenceId: id, status: "ACTIVE" } });
    if (active) throw new ActionError(`${active} prospects are still in this sequence. Stop them first, or turn the sequence off instead.`);
    await db.sequence.delete({ where: { id } });
    await audit(user.id, "sequence.delete", { type: "sequence", id });
    revalidatePath("/outreach/sequences");
    return { ok: true, message: "Sequence deleted." };
  } catch (err) {
    return handleActionError(err);
  }
}

/**
 * Enroll prospects in a sequence. Step 1 is drafted right away into the approval queue;
 * later steps are drafted when due. Skips prospects without a usable email, marked
 * do-not-contact, closed, or already in an active sequence.
 */
export async function enrollAction(input: { companyIds: string[]; sequenceId: string; contactId?: string | null }): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const ids = z.array(z.string()).min(1).max(500).parse(input.companyIds);
    const sequence = await db.sequence.findUniqueOrThrow({ where: { id: input.sequenceId }, include: { steps: { orderBy: { order: "asc" } } } });
    if (!sequence.active) throw new ActionError("That sequence is turned off.");
    const first = sequence.steps[0];
    if (!first) throw new ActionError("That sequence has no steps.");
    const skipped: Record<string, number> = {};
    const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);
    let enrolled = 0;
    for (const companyId of ids) {
      const c = await db.company.findUnique({ where: { id: companyId }, select: { doNotContact: true, archived: true, stage: true } });
      if (!c) continue;
      if (c.doNotContact) { skip("do not contact"); continue; }
      if (c.archived || ["CLOSED_WON", "CLOSED_LOST", "NOT_INTERESTED"].includes(c.stage)) { skip("closed or archived"); continue; }
      const busy = await db.enrollment.count({ where: { companyId, status: { in: ["ACTIVE", "PAUSED"] } } });
      if (busy) { skip("already in a sequence"); continue; }
      const to = await recipientFor(companyId, ids.length === 1 ? input.contactId : null);
      if (!to.email) { skip("no email on file"); continue; }
      await db.enrollment.create({
        data: { companyId, contactId: to.contactId, sequenceId: sequence.id, toEmail: to.email, createdById: user.id, nextStepDueAt: new Date(Date.now() + first.delayDays * 86400_000) },
      });
      enrolled++;
    }
    const drafted = enrolled ? (await advanceEnrollments()).drafted : 0;
    await audit(user.id, "sequence.enroll", { type: "sequence", id: sequence.id }, { enrolled, skipped });
    refresh(ids.length === 1 ? ids[0] : undefined);
    const skippedText = Object.entries(skipped).map(([why, n]) => `${n} ${why}`).join(", ");
    if (!enrolled) return { ok: false, error: `Nobody was enrolled${skippedText ? ` (${skippedText})` : ""}.` };
    return {
      ok: true,
      message: `Enrolled ${enrolled} in "${sequence.name}". ${drafted ? `${drafted} first email${drafted === 1 ? " is" : "s are"} waiting for your approval.` : ""}${skippedText ? ` Skipped: ${skippedText}.` : ""}`.trim(),
    };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function setEnrollmentStatusAction(id: string, status: "ACTIVE" | "PAUSED" | "STOPPED"): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const e = await db.enrollment.findUniqueOrThrow({ where: { id } });
    if (status === "ACTIVE") {
      // Resume: the next step is drafted on the next run (or now).
      await db.enrollment.update({ where: { id }, data: { status: "ACTIVE", stopReason: null, nextStepDueAt: new Date() } });
      await advanceEnrollments();
    } else {
      await db.$transaction([
        db.enrollment.update({ where: { id }, data: { status, stopReason: status === "STOPPED" ? "Stopped by hand" : "Paused by hand", nextStepDueAt: null } }),
        db.emailMessage.updateMany({ where: { enrollmentId: id, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "FAILED"] } }, data: { status: "CANCELLED" } }),
      ]);
    }
    await audit(user.id, "enrollment.status", { type: "enrollment", id }, { status });
    refresh(e.companyId);
    revalidatePath("/outreach/sequences");
    return { ok: true, message: status === "ACTIVE" ? "Resumed." : status === "PAUSED" ? "Paused." : "Stopped." };
  } catch (err) {
    return handleActionError(err);
  }
}
