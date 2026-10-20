import ExcelJS from "exceljs";
import Papa from "papaparse";
import * as XLSX from "xlsx";

export interface ParsedSheet {
  headers: string[];
  records: Record<string, unknown>[];
}

export const MAX_IMPORT_ROWS = 10_000;

export async function parseUpload(fileName: string, data: ArrayBuffer): Promise<ParsedSheet> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx")) return parseXlsx(data);
  if (lower.endsWith(".xls")) return parseWithSheetJs(data);
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) return parseCsv(new TextDecoder("utf-8").decode(data));
  throw new Error("Upload a .csv, .xlsx or .xls file.");
}

export function parseCsv(text: string): ParsedSheet {
  const result = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  const headers = (result.meta.fields ?? []).filter(Boolean);
  if (!headers.length) throw new Error("The file has no header row.");
  if (result.data.length > MAX_IMPORT_ROWS) throw new Error(`Import up to ${MAX_IMPORT_ROWS.toLocaleString()} rows at a time.`);
  return { headers, records: result.data };
}

export async function parseXlsx(data: ArrayBuffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    // ExcelJS can't read some valid files (Strict Open XML, prefixed XML from other apps).
    return parseWithSheetJs(data);
  }
  if (!wb.worksheets.length) return parseWithSheetJs(data);
  const sheet = wb.worksheets.find((w) => w.actualRowCount > 1) ?? wb.worksheets[0];
  if (!sheet) throw new Error("The workbook has no sheets.");
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (c, col) => {
    headers[col - 1] = String(cellValue(c.value) ?? "").trim();
  });
  const records: Record<string, unknown>[] = [];
  for (let r = 2; r <= sheet.actualRowCount + 1 && r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (!row.hasValues) continue;
    const rec: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (h) rec[h] = cellValue(row.getCell(i + 1).value);
    });
    records.push(rec);
    if (records.length > MAX_IMPORT_ROWS) throw new Error(`Import up to ${MAX_IMPORT_ROWS.toLocaleString()} rows at a time.`);
  }
  return { headers: headers.filter(Boolean), records };
}

/** Fallback reader for workbooks ExcelJS can't open, and for legacy .xls. */
export function parseWithSheetJs(data: ArrayBuffer): ParsedSheet {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(new Uint8Array(data), { type: "array", cellDates: true, dense: true });
  } catch {
    throw new Error("Couldn't open that workbook. Try File → Save As → Excel Workbook (.xlsx) or CSV, then upload again.");
  }
  const name = wb.SheetNames.find((n) => (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 }) as unknown[]).length > 1) ?? wb.SheetNames[0];
  if (!name) throw new Error("The workbook has no sheets.");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null, raw: true, blankrows: false });
  const headers = (grid[0] ?? []).map((h) => String(h ?? "").trim());
  if (!headers.some(Boolean)) throw new Error("The file has no header row.");
  const records = grid.slice(1).map((row) => {
    const rec: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (h) rec[h] = row[i] ?? null;
    });
    return rec;
  });
  if (records.length > MAX_IMPORT_ROWS) throw new Error(`Import up to ${MAX_IMPORT_ROWS.toLocaleString()} rows at a time.`);
  return { headers: headers.filter(Boolean), records };
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text; // hyperlink
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return v.result ?? null; // formula
    if ("error" in v) return null;
  }
  return v;
}
