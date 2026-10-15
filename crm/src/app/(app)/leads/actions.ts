"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formObject, handleActionError, type ActionState } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { ActionError, requireActionUser } from "@/lib/auth/session";
import { INDUSTRIES, STAGE_KEYS, STAGE_LABEL, TASK_TYPE_LABEL } from "@/lib/constants";
import { dayKey, parseLocalDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { findMatch } from "@/lib/leads/dedupe";
import { companySchema, contactSchema } from "@/lib/leads/schema";
import { changeStage, derivedCompanyFields, manualFactors, recomputeScore, syncNextFollowUp } from "@/lib/leads/service";
import { SCORING_FACTORS, type FactorKey } from "@/lib/scoring";

const MAX_ATTACHMENT = 4 * 1024 * 1024;

export async function createLeadAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const user = await requireActionUser("SALES");
    const input = companySchema.parse(formObject(fd));
    const derived = derivedCompanyFields(input);
    if (fd.get("ignoreDuplicates") !== "1") {
      const candidates = await db.company.findMany({
        where: {
          OR: [
            { normalizedName: derived.normalizedName as string },
            ...(derived.domain ? [{ domain: derived.domain as string }] : []),
            ...(derived.normalizedPhone ? [{ normalizedPhone: derived.normalizedPhone as string }] : []),
          ],
        },
        select: { id: true, name: true, normalizedName: true, domain: true, normalizedPhone: true, city: true, streetAddress: true },
      });
      const m = findMatch({ normalizedName: derived.normalizedName as string, domain: (derived.domain as string) ?? null, normalizedPhone: (derived.normalizedPhone as string) ?? null, city: input.city, streetAddress: input.streetAddress }, candidates);
      if (m.kind !== "none" && m.match) {
        return {
          ok: false,
          error: `This may already exist as "${m.match.name}" (${m.reasons.join(", ")}). Open it, or save anyway if it's a different business.`,
          data: { duplicateId: m.match.id },
        };
      }
    }
    const company = await db.company.create({
      data: { ...input, ...derived, region: input.region ?? (derived.region as string | null) ?? null, ownerId: input.ownerId } as never,
    });
    await db.activity.create({ data: { companyId: company.id, userId: user.id, type: "UPDATED", summary: "Lead created" } });
    await recomputeScore(company.id);
    await audit(user.id, "lead.create", { type: "company", id: company.id });
    id = company.id;
  } catch (err) {
    return handleActionError(err);
  }
  redirect(`/leads/${id}`);
}

export async function updateLeadAction(companyId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const input = companySchema.parse(formObject(fd));
    const existing = await db.company.findUniqueOrThrow({ where: { id: companyId } });
    const derived = derivedCompanyFields(input);
    await db.$transaction(async (tx) => {
      const { stage, ...rest } = input;
      await tx.company.update({
        where: { id: companyId },
        data: { ...rest, ...derived, region: input.region ?? (derived.region as string | null) ?? existing.region } as never,
      });
      if (stage !== existing.stage) await changeStage(companyId, stage, user.id, undefined, tx);
      await tx.activity.create({ data: { companyId, userId: user.id, type: "UPDATED", summary: "Lead details updated" } });
      await recomputeScore(companyId, tx);
    });
    await audit(user.id, "lead.update", { type: "company", id: companyId });
    revalidatePath(`/leads/${companyId}`);
    return { ok: true, message: "Saved." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function changeStageAction(companyId: string, stage: string, note?: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    if (!(STAGE_KEYS as string[]).includes(stage)) throw new ActionError("Unknown stage.");
    const changed = await db.$transaction((tx) => changeStage(companyId, stage, user.id, note, tx));
    if (changed) await audit(user.id, "lead.stage", { type: "company", id: companyId }, { stage });
    revalidatePath(`/leads/${companyId}`);
    revalidatePath("/pipeline");
    return { ok: true, message: changed ? `Moved to ${STAGE_LABEL[stage]}.` : undefined };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function addNoteAction(companyId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const body = z.string().trim().min(1, "Write a note first.").max(10000).parse(fd.get("body"));
    const type = fd.get("type") === "MEETING" ? "MEETING" : "NOTE";
    await db.activity.create({
      data: { companyId, userId: user.id, type, summary: type === "MEETING" ? "Meeting notes" : "Note", body },
    });
    revalidatePath(`/leads/${companyId}`);
    return { ok: true, message: "Added to the timeline." };
  } catch (err) {
    return handleActionError(err);
  }
}

const taskSchema = z.object({
  type: z.enum(["CALLBACK", "EMAIL", "MEETING", "PROPOSAL", "CONTRACT", "REENGAGE", "OTHER"]),
  title: z.string().trim().max(200).optional(),
  dueAt: z.string().min(1, "Pick a date and time."),
  durationMin: z.preprocess((v) => (v ? Number(v) : null), z.number().int().min(5).max(480).nullable()),
  notes: z.string().trim().max(4000).optional(),
  contactId: z.string().optional(),
  assigneeId: z.string().optional(),
});

export async function createTaskAction(companyId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const input = taskSchema.parse(formObject(fd));
    const dueAt = parseLocalDateTime(input.dueAt);
    if (!dueAt) throw new ActionError("Pick a valid date and time.");
    await createTask(companyId, user.id, { ...input, dueAt });
    revalidatePath(`/leads/${companyId}`);
    revalidatePath("/follow-ups");
    return { ok: true, message: "Follow-up scheduled." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function createTask(
  companyId: string,
  userId: string,
  input: { type: string; title?: string; dueAt: Date; durationMin?: number | null; notes?: string; contactId?: string; assigneeId?: string },
) {
  return db.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        companyId,
        type: input.type as never,
        title: input.title || TASK_TYPE_LABEL[input.type],
        dueAt: input.dueAt,
        durationMin: input.durationMin ?? null,
        notes: input.notes || null,
        contactId: input.contactId || null,
        assigneeId: input.assigneeId || userId,
      },
    });
    await tx.activity.create({
      data: { companyId, userId, type: "FOLLOW_UP_CREATED", summary: `${TASK_TYPE_LABEL[input.type]} scheduled`, meta: { taskId: task.id, dueAt: input.dueAt.toISOString() } },
    });
    await syncNextFollowUp(companyId, tx);
    return task;
  });
}

export async function completeTaskAction(taskId: string, outcome?: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    if (task.completedAt) return { ok: true };
    await db.$transaction(async (tx) => {
      await tx.task.update({ where: { id: taskId }, data: { completedAt: new Date() } });
      await tx.activity.create({
        data: { companyId: task.companyId, userId: user.id, type: task.type === "MEETING" ? "MEETING" : "FOLLOW_UP_DONE", summary: `${task.title} completed`, body: outcome || null, meta: { taskId } },
      });
      await syncNextFollowUp(task.companyId, tx);
    });
    revalidatePath(`/leads/${task.companyId}`);
    revalidatePath("/follow-ups");
    return { ok: true, message: "Marked done." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function rescheduleTaskAction(taskId: string, dueLocal: string): Promise<ActionState> {
  try {
    await requireActionUser("SALES");
    const dueAt = parseLocalDateTime(dueLocal);
    if (!dueAt) throw new ActionError("Pick a valid date and time.");
    const task = await db.task.update({ where: { id: taskId }, data: { dueAt } });
    await syncNextFollowUp(task.companyId);
    revalidatePath("/follow-ups");
    revalidatePath(`/leads/${task.companyId}`);
    return { ok: true, message: "Rescheduled." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function snoozeTaskAction(taskId: string, days: number): Promise<ActionState> {
  try {
    await requireActionUser("SALES");
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    const base = task.dueAt > new Date() ? task.dueAt : new Date();
    await db.task.update({ where: { id: taskId }, data: { dueAt: new Date(base.getTime() + Math.max(1, Math.min(90, days)) * 86_400_000) } });
    await syncNextFollowUp(task.companyId);
    revalidatePath("/follow-ups");
    return { ok: true, message: `Moved ${days} day${days === 1 ? "" : "s"} later.` };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function deleteTaskAction(taskId: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const task = await db.task.delete({ where: { id: taskId } });
    await syncNextFollowUp(task.companyId);
    await audit(user.id, "task.delete", { type: "task", id: taskId });
    revalidatePath("/follow-ups");
    revalidatePath(`/leads/${task.companyId}`);
    return { ok: true, message: "Follow-up removed." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function saveContactAction(companyId: string, contactId: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const input = contactSchema.parse(formObject(fd));
    const verifiedAt = input.emailStatus === "VERIFIED" || input.phoneStatus === "VERIFIED" ? new Date() : undefined;
    await db.$transaction(async (tx) => {
      if (input.isPrimary) await tx.contact.updateMany({ where: { companyId }, data: { isPrimary: false } });
      if (contactId) await tx.contact.update({ where: { id: contactId, companyId }, data: { ...input, ...(verifiedAt ? { verifiedAt } : {}) } });
      else {
        const c = await tx.contact.create({ data: { ...input, companyId, verifiedAt } });
        await tx.activity.create({ data: { companyId, contactId: c.id, userId: user.id, type: "UPDATED", summary: `Contact added: ${c.name}` } });
      }
      await recomputeScore(companyId, tx);
    });
    await audit(user.id, contactId ? "contact.update" : "contact.create", { type: "company", id: companyId });
    revalidatePath(`/leads/${companyId}`);
    return { ok: true, message: "Contact saved." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function deleteContactAction(contactId: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const c = await db.contact.delete({ where: { id: contactId } });
    await recomputeScore(c.companyId);
    await audit(user.id, "contact.delete", { type: "contact", id: contactId }, { companyId: c.companyId });
    revalidatePath(`/leads/${c.companyId}`);
    return { ok: true, message: "Contact removed." };
  } catch (err) {
    return handleActionError(err);
  }
}

/** Quick verification update from the review queue or contact list. */
export async function setVerificationAction(
  target: { kind: "company" | "contact"; id: string },
  field: "email" | "phone",
  status: "VERIFIED" | "UNVERIFIED" | "UNKNOWN" | "INVALID",
): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    let companyId: string;
    if (target.kind === "company") {
      const data = field === "email" ? { mainEmailStatus: status } : { mainPhoneStatus: status };
      const c = await db.company.update({ where: { id: target.id }, data: { ...data, ...(status === "VERIFIED" ? { lastVerifiedAt: new Date() } : {}) } });
      companyId = c.id;
    } else {
      const data = field === "email" ? { emailStatus: status } : { phoneStatus: status };
      const c = await db.contact.update({ where: { id: target.id }, data: { ...data, ...(status === "VERIFIED" ? { verifiedAt: new Date() } : {}) } });
      companyId = c.companyId;
      if (status === "VERIFIED") await db.company.update({ where: { id: companyId }, data: { lastVerifiedAt: new Date() } });
    }
    await recomputeScore(companyId);
    await audit(user.id, "verification.set", { type: target.kind, id: target.id }, { field, status });
    revalidatePath(`/leads/${companyId}`);
    return { ok: true };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function setManualScoreAction(companyId: string, factor: string, share: number | null, evidence: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    if (!SCORING_FACTORS.some((f) => f.key === factor)) throw new ActionError("Unknown factor.");
    const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
    const manual = manualFactors(company.scoreBreakdown);
    if (share === null) delete manual[factor as FactorKey];
    else {
      if (!evidence.trim()) throw new ActionError("Add the evidence for this score so it stays checkable.");
      manual[factor as FactorKey] = { share: Math.max(0, Math.min(1, share)), evidence: evidence.trim().slice(0, 500) };
    }
    await db.company.update({ where: { id: companyId }, data: { scoreBreakdown: { manual } as object } });
    await recomputeScore(companyId);
    await audit(user.id, "lead.score_manual", { type: "company", id: companyId }, { factor, share });
    revalidatePath(`/leads/${companyId}`);
    return { ok: true, message: "Score updated." };
  } catch (err) {
    return handleActionError(err);
  }
}

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1, "Select at least one lead.").max(5000),
  op: z.enum(["stage", "priority", "industry", "owner", "addTag", "removeTag", "archive", "unarchive", "businessStage", "queueToday", "doNotContact"]),
  value: z.string().max(200).optional(),
});

export async function bulkUpdateAction(raw: { ids: string[]; op: string; value?: string }): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const { ids, op, value } = bulkSchema.parse(raw);
    let count = 0;
    switch (op) {
      case "stage": {
        if (!value || !(STAGE_KEYS as string[]).includes(value)) throw new ActionError("Pick a stage.");
        for (const id of ids) if (await db.$transaction((tx) => changeStage(id, value, user.id, "Bulk update", tx))) count++;
        break;
      }
      case "priority":
        if (!value || !["HIGH", "MEDIUM", "LOW"].includes(value)) throw new ActionError("Pick a priority.");
        count = (await db.company.updateMany({ where: { id: { in: ids } }, data: { priority: value as never } })).count;
        break;
      case "industry":
        if (!value || !INDUSTRIES.some((i) => i.key === value)) throw new ActionError("Pick an industry.");
        count = (await db.company.updateMany({ where: { id: { in: ids } }, data: { industry: value } })).count;
        for (const id of ids) await recomputeScore(id);
        break;
      case "businessStage":
        if (!value || !["STARTUP", "ESTABLISHED", "UNKNOWN"].includes(value)) throw new ActionError("Pick a business type.");
        count = (await db.company.updateMany({ where: { id: { in: ids } }, data: { businessStage: value as never } })).count;
        break;
      case "owner":
        count = (await db.company.updateMany({ where: { id: { in: ids } }, data: { ownerId: value && value !== "none" ? value : null } })).count;
        break;
      case "addTag":
      case "removeTag": {
        const tag = value?.trim().toLowerCase();
        if (!tag) throw new ActionError("Type a tag.");
        const rows = await db.company.findMany({ where: { id: { in: ids } }, select: { id: true, tags: true } });
        for (const r of rows) {
          const tags = op === "addTag" ? Array.from(new Set([...r.tags, tag])) : r.tags.filter((t) => t !== tag);
          await db.company.update({ where: { id: r.id }, data: { tags } });
          count++;
        }
        break;
      }
      case "archive":
      case "unarchive":
        count = (await db.company.updateMany({ where: { id: { in: ids } }, data: { archived: op === "archive" } })).count;
        break;
      case "doNotContact":
        count = (await db.company.updateMany({ where: { id: { in: ids } }, data: { doNotContact: value === "true" } })).count;
        break;
      case "queueToday": {
        const day = dayKey();
        const existing = await db.callQueueItem.findMany({ where: { day, userId: user.id }, select: { companyId: true, position: true } });
        const have = new Set(existing.map((e) => e.companyId));
        let pos = existing.reduce((m, e) => Math.max(m, e.position), 0);
        const add = ids.filter((id) => !have.has(id));
        await db.callQueueItem.createMany({ data: add.map((companyId) => ({ day, userId: user.id, companyId, position: ++pos, reason: "Added by hand" })), skipDuplicates: true });
        count = add.length;
        break;
      }
    }
    await audit(user.id, "lead.bulk", { type: "company" }, { op, value, count: ids.length });
    revalidatePath("/leads");
    return { ok: true, message: `Updated ${count} lead${count === 1 ? "" : "s"}.` };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function saveViewAction(name: string, search: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("VIEWER");
    const clean = z.string().trim().min(1, "Name the view.").max(60).parse(name);
    const params = Object.fromEntries(new URLSearchParams(search));
    delete params.page;
    await db.savedView.create({ data: { userId: user.id, name: clean, filters: params } });
    revalidatePath("/leads");
    return { ok: true, message: "View saved." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function deleteViewAction(id: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("VIEWER");
    await db.savedView.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/leads");
    return { ok: true };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function uploadAttachmentAction(companyId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ActionError("Choose a file.");
    if (file.size > MAX_ATTACHMENT) throw new ActionError("Files must be 4 MB or smaller.");
    const name = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 200);
    const a = await db.attachment.create({
      data: { companyId, fileName: name, mimeType: file.type || "application/octet-stream", size: file.size, data: new Uint8Array(await file.arrayBuffer()), uploadedBy: user.id },
    });
    await db.activity.create({ data: { companyId, userId: user.id, type: "ATTACHMENT", summary: `File added: ${name}`, meta: { attachmentId: a.id } } });
    await audit(user.id, "attachment.upload", { type: "company", id: companyId }, { name, size: file.size });
    revalidatePath(`/leads/${companyId}`);
    return { ok: true, message: "File uploaded." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function deleteAttachmentAction(id: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const a = await db.attachment.delete({ where: { id }, select: { companyId: true, fileName: true } });
    await audit(user.id, "attachment.delete", { type: "attachment", id }, { name: a.fileName });
    revalidatePath(`/leads/${a.companyId}`);
    return { ok: true, message: "File deleted." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function markReplyAction(companyId: string, note: string): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    await db.$transaction(async (tx) => {
      await tx.activity.create({ data: { companyId, userId: user.id, type: "REPLY_RECEIVED", summary: "Reply received", body: note || null } });
      await tx.enrollment.updateMany({ where: { companyId, status: { in: ["ACTIVE", "PAUSED"] } }, data: { status: "REPLIED", stopReason: "Prospect replied", nextStepDueAt: null } });
      await tx.emailMessage.updateMany({ where: { companyId, status: { in: ["PENDING_APPROVAL", "DRAFT"] }, enrollmentId: { not: null } }, data: { status: "CANCELLED", error: "Sequence stopped: prospect replied" } });
      await tx.company.update({ where: { id: companyId }, data: { lastContactedAt: new Date() } });
    });
    const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { stage: true } });
    if (["NEW_LEAD", "RESEARCHING", "READY_TO_CONTACT", "ATTEMPTED_CONTACT"].includes(company.stage)) await changeStage(companyId, "CONTACTED", user.id, "Prospect replied");
    revalidatePath(`/leads/${companyId}`);
    revalidatePath("/outreach");
    return { ok: true, message: "Reply logged. Automatic follow-ups for this lead are stopped." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function deleteLeadAction(companyId: string): Promise<void> {
  const user = await requireActionUser("ADMIN");
  const c = await db.company.delete({ where: { id: companyId }, select: { name: true } });
  await audit(user.id, "lead.delete", { type: "company", id: companyId }, { name: c.name });
  redirect("/leads");
}

const RESEARCH_TO_COMPANY: Record<string, string> = {
  website: "website", description: "description", subindustry: "subindustry", streetAddress: "streetAddress", city: "city", state: "state", zip: "zip",
  mainPhone: "mainPhone", mainEmail: "mainEmail", contactFormUrl: "contactFormUrl", fundingStage: "fundingStage", growthIndicators: "growthIndicators",
  ownershipType: "ownershipType", openingLine: "personalNote",
};

/** Apply a sourced finding to the lead. Contact details stay Unverified until someone confirms them. */
export async function decideFindingAction(findingId: string, accept: boolean): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const f = await db.researchFinding.findUniqueOrThrow({ where: { id: findingId } });
    if (f.status !== "PENDING") return { ok: true };
    if (accept) {
      const company = await db.company.findUniqueOrThrow({ where: { id: f.companyId } });
      const data: Record<string, unknown> = {};
      const field = RESEARCH_TO_COMPANY[f.field];
      if (field) {
        data[field] = f.value;
        if (f.field === "mainPhone") data.mainPhoneStatus = "UNVERIFIED";
        if (f.field === "mainEmail") data.mainEmailStatus = "UNVERIFIED";
        Object.assign(data, derivedCompanyFields({ ...company, [field]: f.value, region: company.region }));
      } else if (f.field === "industry") {
        if (INDUSTRIES.some((i) => i.key === f.value)) data.industry = f.value;
        else data.subindustry = f.value;
      } else if (f.field === "employeeCount") {
        const n = Number(f.value.replace(/[^\d]/g, ""));
        if (Number.isInteger(n) && n > 0) Object.assign(data, { employeeCount: n, employeeCountSource: f.sourceUrl });
        else throw new ActionError("That employee count isn't a single number; add it by hand from the source.");
      } else if (f.field === "contact") {
        const [name, title] = f.value.split(/\s+[—–-]\s+/);
        await db.contact.create({ data: { companyId: f.companyId, name: name.trim(), title: title?.trim() || null, source: f.sourceUrl } });
      } else if (f.field === "technology") {
        data.notes = [company.notes, `Technology clue: ${f.value} (source: ${f.sourceUrl})`].filter(Boolean).join("\n");
      }
      if (Object.keys(data).length) await db.company.update({ where: { id: f.companyId }, data });
      await recomputeScore(f.companyId);
    }
    await db.researchFinding.update({ where: { id: findingId }, data: { status: accept ? "ACCEPTED" : "REJECTED", decidedAt: new Date() } });
    await audit(user.id, accept ? "research.accept" : "research.reject", { type: "company", id: f.companyId }, { field: f.field });
    revalidatePath(`/leads/${f.companyId}`);
    return { ok: true, message: accept ? "Applied to the lead." : "Dismissed." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function addFindingAction(companyId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const input = z
      .object({
        field: z.string().min(1),
        value: z.string().trim().min(1).max(2000),
        sourceUrl: z.string().trim().url("Add the link where you saw this.").refine((u) => /^https?:\/\//i.test(u), "Use an http(s) link."),
      })
      .parse(formObject(fd));
    await db.researchFinding.create({ data: { companyId, field: input.field, value: input.value, sourceUrl: input.sourceUrl, createdById: user.id } });
    revalidatePath(`/leads/${companyId}`);
    return { ok: true, message: "Finding saved. Accept it to apply it to the lead." };
  } catch (err) {
    return handleActionError(err);
  }
}
