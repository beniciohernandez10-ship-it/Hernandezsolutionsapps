import ExcelJS from "exceljs";
import { routeUser } from "@/lib/auth/session";
import { csvResponse, toCsv } from "@/lib/csv";
import { TEMPLATE_EXAMPLE, TEMPLATE_HEADERS } from "@/lib/import/template";

/** Blank import templates with headers the importer maps automatically. */
export async function GET(req: Request) {
  const user = await routeUser("SALES");
  if (user instanceof Response) return user;
  const format = new URL(req.url).searchParams.get("format");
  const example = TEMPLATE_HEADERS.map((h) => TEMPLATE_EXAMPLE[h.key] ?? "");
  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Leads");
    ws.addRow(TEMPLATE_HEADERS.map((h) => h.header));
    ws.addRow(example);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.columns.forEach((c) => (c.width = 20));
    const notes = wb.addWorksheet("How to fill");
    notes.addRow(["Column", "What to put"]);
    TEMPLATE_HEADERS.forEach((h) => notes.addRow([h.header, h.help]));
    notes.getRow(1).font = { bold: true };
    notes.columns = [{ width: 28 }, { width: 90 }];
    const buf = await wb.xlsx.writeBuffer();
    return new Response(buf as ArrayBuffer, {
      headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="lead-import-template.xlsx"' },
    });
  }
  return csvResponse("lead-import-template.csv", toCsv(TEMPLATE_HEADERS.map((h) => h.header), [example]));
}
