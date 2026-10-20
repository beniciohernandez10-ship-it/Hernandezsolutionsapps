import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseUpload } from "@/lib/import/parse";

const toArrayBuffer = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

async function standardXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Leads");
  ws.addRow(["Company name", "City", "Email"]);
  ws.addRow(["Acme Dental", "Oakland", "info@acme.com"]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Rewrites the workbook part with an "x:" namespace prefix, as some apps write it. ExcelJS can't read this. */
async function prefixedXlsx() {
  const zip = await JSZip.loadAsync(await standardXlsx());
  const xml = await zip.file("xl/workbook.xml")!.async("string");
  const prefixed = xml
    .replace(/<(\/?)(?!\?)([a-zA-Z]+)(?=[\s>/])/g, "<$1x:$2")
    .replace(/xmlns="([^"]+)"/, 'xmlns:x="$1"');
  zip.file("xl/workbook.xml", prefixed);
  return zip.generateAsync({ type: "uint8array" });
}

const expected = { headers: ["Company name", "City", "Email"], records: [{ "Company name": "Acme Dental", City: "Oakland", Email: "info@acme.com" }] };

describe("parseUpload", () => {
  it("reads a standard .xlsx", async () => {
    expect(await parseUpload("leads.xlsx", toArrayBuffer(await standardXlsx()))).toEqual(expected);
  });

  it("falls back for workbooks ExcelJS can't open", async () => {
    expect(await parseUpload("leads.xlsx", toArrayBuffer(await prefixedXlsx()))).toEqual(expected);
  });

  it("reads legacy .xls", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Company name", "City", "Email"], ["Acme Dental", "Oakland", "info@acme.com"]]), "Leads");
    const data = XLSX.write(wb, { type: "array", bookType: "biff8" }) as ArrayBuffer;
    expect(await parseUpload("leads.xls", data)).toEqual(expected);
  });

  it("the prefixed sample really defeats ExcelJS, so the fallback is exercised", async () => {
    const wb = new ExcelJS.Workbook();
    const failed = await wb.xlsx.load(toArrayBuffer(await prefixedXlsx())).then(() => wb.worksheets.length === 0, () => true);
    expect(failed).toBe(true);
  });
});
