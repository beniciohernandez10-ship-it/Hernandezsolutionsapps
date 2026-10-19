"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { handleActionError, type ActionState } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { ActionError, requireActionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { IMPORT_FIELDS, autoMap, type ColumnMapping } from "@/lib/import/mapping";
import { normalizeRecord } from "@/lib/import/normalize-row";
import { parseUpload } from "@/lib/import/parse";
import { createFromRow, mergeInto, runImport } from "@/lib/import/run";
import type { ImportRow } from "@/lib/import/types";
import { recomputeScore } from "@/lib/leads/service";
import { rateLimit } from "@/lib/ratelimit";

const MAX_BYTES = 4 * 1024 * 1024;

async function readUpload(fd: FormData) {
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) throw new ActionError("Choose a CSV or Excel file.");
  if (file.size > MAX_BYTES) throw new ActionError("Files up to 4 MB can be imported here. Split larger files, or use the command-line import in the setup guide.");
  try {
    return { name: file.name, sheet: await parseUpload(file.name, await file.arrayBuffer()) };
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : "Couldn't read that file.");
  }
}

export interface AnalyzeResult {
  fileName: string;
  headers: string[];
  mapping: ColumnMapping;
  sample: Record<string, string>[];
  rows: number;
}

export async function analyzeImportAction(fd: FormData): Promise<ActionState> {
  try {
    await requireActionUser("SALES");
    const { name, sheet } = await readUpload(fd);
    const sample = sheet.records.slice(0, 5).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "")])));
    const data: AnalyzeResult = { fileName: name, headers: sheet.headers, mapping: autoMap(sheet.headers), sample, rows: sheet.records.length };
    return { ok: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

const fieldKeys = IMPORT_FIELDS.map((f) => f.key) as string[];

export async function runImportAction(fd: FormData): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const dryRun = fd.get("dryRun") === "1";
    if (!dryRun && !(await rateLimit(`import:${user.id}`, 30, 3600))) throw new ActionError("Import limit reached for this hour.");
    const { name, sheet } = await readUpload(fd);
    const rawMapping = z.record(z.string(), z.string()).parse(JSON.parse(String(fd.get("mapping") ?? "{}")));
    const mapping: ColumnMapping = {};
    for (const [k, v] of Object.entries(rawMapping)) if (fieldKeys.includes(k) && sheet.headers.includes(v)) mapping[k as keyof ColumnMapping] = v;
    if (!mapping.name) throw new ActionError("Map a column to Company name first.");
    const tags = String(fd.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 5);
    const rows: ImportRow[] = [];
    const skipped: { rowNumber: number; skip: string }[] = [];
    sheet.records.forEach((rec, i) => {
      const r = normalizeRecord(rec, mapping, i + 2, tags);
      if ("skip" in r) skipped.push(r);
      else rows.push(r);
    });
    const { report, batchId } = await runImport(rows, { fileName: name, userId: user.id, dryRun, skipped });
    if (!dryRun) {
      await audit(user.id, "import.run", { type: "import", id: batchId }, { file: name, created: report.created, merged: report.merged, flagged: report.flagged });
      revalidatePath("/leads");
      revalidatePath("/import");
    }
    return { ok: true, data: { report, batchId } };
  } catch (err) {
    return handleActionError(err);
  }
}

/** Resolve a possible duplicate held back during import. */
export async function resolveDuplicateAction(id: string, decision: "MERGED" | "KEPT_SEPARATE" | "DISCARDED"): Promise<ActionState> {
  try {
    const user = await requireActionUser("SALES");
    const review = await db.duplicateReview.findUniqueOrThrow({ where: { id }, include: { batch: { select: { fileName: true } } } });
    if (review.status !== "OPEN") throw new ActionError("Already resolved.");
    const row = review.candidate as unknown as ImportRow;
    const fileName = review.batch?.fileName ?? "import";
    let companyId = review.companyId;
    await db.$transaction(async (tx) => {
      if (decision === "MERGED") await mergeInto(tx, review.companyId, row, fileName, user.id);
      if (decision === "KEPT_SEPARATE") {
        // A Lead ID already used by the other record can't be reused.
        const clash = row.externalId ? await tx.company.findUnique({ where: { externalId: row.externalId } }) : null;
        companyId = (await createFromRow(tx, clash ? { ...row, externalId: null } : row, fileName, user.id)).id;
      }
      await tx.duplicateReview.update({ where: { id }, data: { status: decision, decidedById: user.id, decidedAt: new Date() } });
    });
    if (decision !== "DISCARDED") await recomputeScore(companyId);
    await audit(user.id, "import.duplicate", { type: "company", id: companyId }, { decision });
    revalidatePath("/import/review");
    revalidatePath("/leads");
    return { ok: true, message: decision === "MERGED" ? "Merged into the existing record." : decision === "KEPT_SEPARATE" ? "Created as a separate prospect." : "Discarded." };
  } catch (err) {
    return handleActionError(err);
  }
}
