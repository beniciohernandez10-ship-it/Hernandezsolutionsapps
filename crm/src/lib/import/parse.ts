import ExcelJS from "exceljs";
import Papa from "papaparse";

export interface ParsedSheet {
  headers: string[];
  records: Record<string, unknown>[];
}

export const MAX_IMPORT_ROWS = 10_000;

export async function parseUpload(fileName: string, data: ArrayBuffer): Promise<ParsedSheet> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx")) return parseXlsx(data);
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) return parseCsv(new TextDecoder("utf-8").decode(data));
  throw new Error("Upload a .csv or .xlsx file. Older .xls files need to be saved as .xlsx first.");
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
  await wb.xlsx.load(data);
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
