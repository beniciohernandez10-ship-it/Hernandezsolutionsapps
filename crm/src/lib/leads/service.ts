import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { STAGE_LABEL } from "../constants";
import { domainFromEmail, domainFromWebsite, isFreeMailDomain, normalizeName, normalizePhone, regionFor } from "../normalize";
import { computeScore, type FactorKey, type ManualFactor } from "../scoring";
import { getSetting } from "../settings";

/** Fields derived from what a person typed: normalized keys for duplicates, region, domain. */
export function derivedCompanyFields(input: {
  name?: string | null;
  website?: string | null;
  mainEmail?: string | null;
  mainPhone?: string | null;
  city?: string | null;
  state?: string | null;
  region?: string | null;
}) {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined && input.name !== null) out.normalizedName = normalizeName(input.name);
  if (input.website !== undefined || input.mainEmail !== undefined) {
    const emailDomain = domainFromEmail(input.mainEmail);
    out.domain = domainFromWebsite(input.website) ?? (emailDomain && !isFreeMailDomain(emailDomain) ? emailDomain : null);
  }
  if (input.mainPhone !== undefined) out.normalizedPhone = normalizePhone(input.mainPhone);
  if (!input.region && (input.city || input.state)) out.region = regionFor(input.city, input.state);
  return out;
}

export function manualFactors(breakdown: unknown): Partial<Record<FactorKey, ManualFactor>> {
  if (!breakdown || typeof breakdown !== "object") return {};
  const manual = (breakdown as { manual?: unknown }).manual;
  return manual && typeof manual === "object" ? (manual as Partial<Record<FactorKey, ManualFactor>>) : {};
}

/** Recalculate and store a lead's score from its current record and contacts. */
export async function recomputeScore(companyId: string, tx: Prisma.TransactionClient = db): Promise<void> {
  const company = await tx.company.findUnique({ where: { id: companyId }, include: { contacts: true } });
  if (!company) return;
  const config = await getSetting("scoring");
  const manual = manualFactors(company.scoreBreakdown);
  const result = computeScore({ ...company, contacts: company.contacts, manual }, config);
  await tx.company.update({
    where: { id: companyId },
    data: { score: result.total, scoreIsEstimate: result.isEstimate, scoreBreakdown: { manual, factors: result.factors } as object },
  });
}

export async function logActivity(data: Prisma.ActivityUncheckedCreateInput, tx: Prisma.TransactionClient = db) {
  return tx.activity.create({ data });
}

/** Move a lead to a new stage and record it on the timeline. No-op when unchanged. */
export async function changeStage(companyId: string, stage: string, userId: string | null, note?: string, tx: Prisma.TransactionClient = db): Promise<boolean> {
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { stage: true } });
  if (company.stage === stage) return false;
  await tx.company.update({ where: { id: companyId }, data: { stage: stage as never, stageChangedAt: new Date() } });
  await tx.activity.create({
    data: {
      companyId,
      userId,
      type: "STAGE_CHANGE",
      summary: `Stage: ${STAGE_LABEL[company.stage]} → ${STAGE_LABEL[stage]}`,
      body: note,
      meta: { from: company.stage, to: stage },
    },
  });
  return true;
}

/** Earliest open follow-up becomes the lead's "next follow-up date". */
export async function syncNextFollowUp(companyId: string, tx: Prisma.TransactionClient = db): Promise<void> {
  const next = await tx.task.findFirst({ where: { companyId, completedAt: null }, orderBy: { dueAt: "asc" }, select: { dueAt: true } });
  await tx.company.update({ where: { id: companyId }, data: { nextFollowUpAt: next?.dueAt ?? null } });
}
