import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { normalizeName, normalizePhone, domainFromWebsite, domainFromEmail, isFreeMailDomain } from "../normalize";
import { findMatch, type DedupeKey } from "../leads/dedupe";
import { recomputeScore } from "../leads/service";
import type { ImportReport, ImportRow, RowOutcome } from "./types";

type Existing = DedupeKey & { id: string; name: string; externalId: string | null };

function keyOf(row: ImportRow): DedupeKey {
  const emailDomain = domainFromEmail(row.mainEmail);
  return {
    normalizedName: normalizeName(row.name),
    domain: domainFromWebsite(row.website) ?? (emailDomain && !isFreeMailDomain(emailDomain) ? emailDomain : null),
    normalizedPhone: normalizePhone(row.mainPhone),
    city: row.city,
    streetAddress: row.streetAddress,
    zip: row.zip,
  };
}

export function companyCreateData(row: ImportRow, ownerId: string | null): Prisma.CompanyUncheckedCreateInput {
  const k = keyOf(row);
  return {
    externalId: row.externalId,
    name: row.name,
    normalizedName: k.normalizedName,
    industry: row.industry,
    subindustry: row.subindustry,
    businessStage: row.businessStage,
    website: row.website,
    domain: k.domain,
    streetAddress: row.streetAddress,
    city: row.city,
    state: row.state,
    zip: row.zip,
    region: row.region,
    headquarters: row.headquarters,
    employeeCount: row.employeeCount,
    employeeCountSource: row.employeeCountSource,
    description: row.description,
    ownershipType: row.ownershipType,
    fundingStage: row.fundingStage,
    growthIndicators: row.growthIndicators,
    mainEmail: row.mainEmail,
    mainEmailStatus: row.mainEmailStatus,
    mainPhone: row.mainPhone,
    normalizedPhone: k.normalizedPhone,
    mainPhoneStatus: row.mainPhoneStatus,
    contactFormUrl: row.contactFormUrl,
    preferredContactMethod: row.preferredContactMethod,
    source: row.source,
    sourceUrl: row.sourceUrl,
    personalNote: row.personalNote,
    priority: row.priority,
    stage: row.stage as never,
    lastContactedAt: row.lastContactedAt ? new Date(row.lastContactedAt) : null,
    managedUsers: row.managedUsers,
    notes: row.notes,
    tags: row.tags,
    ownerId,
  };
}

/** Fill only fields that are empty on the existing record; never overwrite what is already there. */
export async function mergeInto(tx: Prisma.TransactionClient, companyId: string, row: ImportRow, fileName: string, userId: string | null): Promise<number> {
  const existing = await tx.company.findUniqueOrThrow({ where: { id: companyId }, include: { contacts: true } });
  const incoming = companyCreateData(row, null) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  const fillable = [
    "externalId", "website", "domain", "streetAddress", "city", "state", "zip", "region", "headquarters", "employeeCount", "employeeCountSource",
    "description", "ownershipType", "fundingStage", "growthIndicators", "mainEmail", "mainPhone", "normalizedPhone", "contactFormUrl",
    "source", "sourceUrl", "personalNote", "managedUsers", "subindustry",
  ] as const;
  for (const f of fillable) {
    const current = (existing as Record<string, unknown>)[f];
    if ((current === null || current === undefined || current === "") && incoming[f] !== null && incoming[f] !== undefined) {
      if (f === "externalId" && (await tx.company.findUnique({ where: { externalId: row.externalId! } }))) continue;
      data[f] = incoming[f];
      if (f === "mainEmail") data.mainEmailStatus = row.mainEmailStatus;
      if (f === "mainPhone") data.mainPhoneStatus = row.mainPhoneStatus;
    }
  }
  if (existing.industry === "other" && row.industry !== "other") data.industry = row.industry;
  if (existing.businessStage === "UNKNOWN" && row.businessStage !== "UNKNOWN") data.businessStage = row.businessStage;
  if (existing.preferredContactMethod === "UNKNOWN" && row.preferredContactMethod !== "UNKNOWN") data.preferredContactMethod = row.preferredContactMethod;
  data.tags = Array.from(new Set([...existing.tags, ...row.tags]));
  if (row.notes && !(existing.notes ?? "").includes(row.notes)) data.notes = [existing.notes, `From ${fileName} (row ${row.rowNumber}):\n${row.notes}`].filter(Boolean).join("\n\n");
  await tx.company.update({ where: { id: companyId }, data });

  let added = 0;
  for (const c of row.contacts) {
    const dupe = existing.contacts.find(
      (e) => (c.email && e.email?.toLowerCase() === c.email) || e.name.trim().toLowerCase() === c.name.trim().toLowerCase(),
    );
    if (dupe) {
      const fill: Record<string, unknown> = {};
      if (!dupe.email && c.email) Object.assign(fill, { email: c.email, emailStatus: c.emailStatus });
      if (!dupe.phone && c.phone) Object.assign(fill, { phone: c.phone, phoneStatus: c.phoneStatus });
      if (!dupe.title && c.title) fill.title = c.title;
      if (!dupe.linkedinUrl && c.linkedinUrl) fill.linkedinUrl = c.linkedinUrl;
      if (Object.keys(fill).length) await tx.contact.update({ where: { id: dupe.id }, data: fill });
      continue;
    }
    await tx.contact.create({ data: { ...c, companyId, source: row.source ?? fileName } });
    added++;
  }
  await tx.activity.create({
    data: { companyId, userId, type: "IMPORTED", summary: `Merged from ${fileName}`, meta: { row: row.rowNumber, externalId: row.externalId } },
  });
  return added;
}

export async function createFromRow(tx: Prisma.TransactionClient, row: ImportRow, fileName: string, userId: string | null): Promise<{ id: string; contacts: number }> {
  const company = await tx.company.create({ data: companyCreateData(row, userId) });
  if (row.contacts.length) {
    await tx.contact.createMany({
      data: row.contacts.map((c, i) => ({ ...c, companyId: company.id, isPrimary: i === 0, source: row.source ?? fileName })),
    });
  }
  await tx.activity.create({
    data: { companyId: company.id, userId, type: "IMPORTED", summary: `Imported from ${fileName}`, meta: { row: row.rowNumber, externalId: row.externalId } },
  });
  return { id: company.id, contacts: row.contacts.length };
}

/**
 * Import normalized rows. Exact matches (two agreeing signals, or the same Lead ID) are merged
 * without overwriting; uncertain matches are held for manual review and not created.
 * With dryRun, nothing is written and the report shows what would happen.
 */
export async function runImport(rows: ImportRow[], opts: { fileName: string; userId: string | null; dryRun?: boolean; skipped?: { rowNumber: number; skip: string }[] }): Promise<{ report: ImportReport; batchId: string | null }> {
  const { fileName, userId, dryRun = false } = opts;
  const existing: Existing[] = await db.company.findMany({
    select: { id: true, name: true, externalId: true, normalizedName: true, domain: true, normalizedPhone: true, city: true, streetAddress: true, zip: true },
  });
  const byExternal = new Map(existing.filter((e) => e.externalId).map((e) => [e.externalId!, e]));
  const outcomes: RowOutcome[] = (opts.skipped ?? []).map((s) => ({ rowNumber: s.rowNumber, name: "", externalId: null, result: "skipped", reasons: [s.skip] }));
  const pendingReviews: { companyId: string; row: ImportRow; reasons: string[] }[] = [];
  const createdIds: string[] = [];
  const touched = new Set<string>();
  let contactsCreated = 0;

  const batch = dryRun ? null : await db.importBatch.create({ data: { fileName, createdById: userId, report: {} } });

  for (const row of rows) {
    const key = keyOf(row);
    let match: { kind: "same" | "ambiguous" | "none"; match?: Existing; reasons: string[] } =
      row.externalId && byExternal.has(row.externalId)
        ? { kind: "same", match: byExternal.get(row.externalId)!, reasons: [`same Lead ID (${row.externalId})`] }
        : findMatch(key, existing);
    // Same name, both without any location or contact details: too little to tell apart, so ask.
    if (match.kind === "none" && !key.city && !key.domain && !key.normalizedPhone) {
      const sameName = existing.find((e) => e.normalizedName === key.normalizedName);
      if (sameName) match = { kind: "ambiguous", match: sameName, reasons: ["same company name", "no location, website or phone to compare"] };
    }

    if (match.kind === "same" && match.match) {
      touched.add(match.match.id);
      outcomes.push({ rowNumber: row.rowNumber, name: row.name, externalId: row.externalId, result: "merged", companyId: match.match.id, matchedName: match.match.name, reasons: match.reasons, warnings: row.warnings });
      if (!dryRun) contactsCreated += await db.$transaction((tx) => mergeInto(tx, match.match!.id, row, fileName, userId));
      continue;
    }
    if (match.kind === "ambiguous" && match.match) {
      outcomes.push({ rowNumber: row.rowNumber, name: row.name, externalId: row.externalId, result: "flagged", companyId: match.match.id, matchedName: match.match.name, reasons: match.reasons, warnings: row.warnings });
      pendingReviews.push({ companyId: match.match.id, row, reasons: match.reasons });
      continue;
    }
    if (dryRun) {
      const fakeId = `new-${row.rowNumber}`;
      existing.push({ id: fakeId, name: row.name, externalId: row.externalId, ...key });
      if (row.externalId) byExternal.set(row.externalId, existing[existing.length - 1]);
      outcomes.push({ rowNumber: row.rowNumber, name: row.name, externalId: row.externalId, result: "created", warnings: row.warnings });
      contactsCreated += row.contacts.length;
      continue;
    }
    const created = await db.$transaction((tx) => createFromRow(tx, row, fileName, userId));
    contactsCreated += created.contacts;
    createdIds.push(created.id);
    touched.add(created.id);
    const entry: Existing = { id: created.id, name: row.name, externalId: row.externalId, ...key };
    existing.push(entry);
    if (row.externalId) byExternal.set(row.externalId, entry);
    outcomes.push({ rowNumber: row.rowNumber, name: row.name, externalId: row.externalId, result: "created", companyId: created.id, warnings: row.warnings });
  }

  if (!dryRun && batch) {
    for (const p of pendingReviews) {
      await db.duplicateReview.create({ data: { batchId: batch.id, companyId: p.companyId, candidate: p.row as unknown as object, reasons: p.reasons } });
    }
    for (const id of touched) await recomputeScore(id);
  }

  const all = rows;
  const hasLocation = (r: ImportRow) => !!(r.city || r.streetAddress || r.zip || r.headquarters);
  const confirmed = dryRun ? 0 : await db.company.count({ where: { id: { in: createdIds } } });
  const report: ImportReport = {
    fileName,
    dryRun,
    totalRecords: rows.length + (opts.skipped?.length ?? 0),
    created: outcomes.filter((o) => o.result === "created").length,
    merged: outcomes.filter((o) => o.result === "merged").length,
    flagged: outcomes.filter((o) => o.result === "flagged").length,
    skipped: outcomes.filter((o) => o.result === "skipped").length,
    uniqueCompanies: new Set(outcomes.filter((o) => o.result === "created" || o.result === "merged").map((o) => o.companyId ?? `new-${o.rowNumber}`)).size,
    contactsCreated,
    verifiedEmailContacts: all.filter((r) => r.mainEmailStatus === "VERIFIED" || r.contacts.some((c) => c.email && c.emailStatus === "VERIFIED")).length,
    verifiedPhoneContacts: all.filter((r) => r.mainPhoneStatus === "VERIFIED" || r.contacts.some((c) => c.phone && c.phoneStatus === "VERIFIED")).length,
    missing: {
      email: all.filter((r) => !r.mainEmail && !r.contacts.some((c) => c.email)).length,
      phone: all.filter((r) => !r.mainPhone && !r.contacts.some((c) => c.phone)).length,
      location: all.filter((r) => !hasLocation(r)).length,
      industry: all.filter((r) => r.industry === "other").length,
      contactName: all.filter((r) => !r.contacts.length).length,
      website: all.filter((r) => !r.website).length,
    },
    confirmedInDatabase: confirmed,
    rows: outcomes.sort((a, b) => a.rowNumber - b.rowNumber),
  };
  if (batch) await db.importBatch.update({ where: { id: batch.id }, data: { report: report as unknown as object } });
  return { report, batchId: batch?.id ?? null };
}
