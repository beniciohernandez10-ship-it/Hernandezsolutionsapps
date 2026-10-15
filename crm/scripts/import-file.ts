/**
 * Import a CSV/XLSX lead file from the command line (same rules as the Import page).
 *   npm run import:file -- path/to/leads.csv [--dry-run] [--tag some-tag]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { autoMap } from "../src/lib/import/mapping";
import { normalizeRecord } from "../src/lib/import/normalize-row";
import { parseUpload } from "../src/lib/import/parse";
import { runImport } from "../src/lib/import/run";
import type { ImportRow } from "../src/lib/import/types";
import { db } from "../src/lib/db";

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("Usage: npm run import:file -- <file.csv|file.xlsx> [--dry-run] [--tag name]");
  const dryRun = args.includes("--dry-run");
  const tagIdx = args.indexOf("--tag");
  const tags = tagIdx >= 0 && args[tagIdx + 1] ? [args[tagIdx + 1]] : [];
  const buf = await readFile(file);
  const sheet = await parseUpload(file, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const mapping = autoMap(sheet.headers);
  console.log("Column mapping:", mapping);
  const rows: ImportRow[] = [];
  const skipped: { rowNumber: number; skip: string }[] = [];
  sheet.records.forEach((rec, i) => {
    const r = normalizeRecord(rec, mapping, i + 2, tags);
    if ("skip" in r) skipped.push(r);
    else rows.push(r);
  });
  const owner = await db.user.findFirst({ where: { role: "OWNER" }, orderBy: { createdAt: "asc" } });
  const { report } = await runImport(rows, { fileName: path.basename(file), userId: owner?.id ?? null, dryRun, skipped });
  const { rows: detail, ...summary } = report;
  console.log(JSON.stringify(summary, null, 2));
  for (const r of detail) if (r.result !== "created" || r.warnings?.length) console.log(`row ${r.rowNumber} ${r.result}: ${r.name}${r.matchedName ? ` ↔ ${r.matchedName}` : ""} ${[...(r.reasons ?? []), ...(r.warnings ?? [])].join("; ")}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
