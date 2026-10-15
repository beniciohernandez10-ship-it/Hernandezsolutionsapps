import ExcelJS from "exceljs";
import { audit } from "@/lib/audit";
import { routeUser } from "@/lib/auth/session";
import { BUSINESS_STAGE_LABEL, CONTACT_METHOD_LABEL, INDUSTRY_LABEL, PRIORITY_LABEL, REGION_LABEL, STAGE_LABEL, VERIFICATION_LABEL } from "@/lib/constants";
import { csvResponse, toCsv } from "@/lib/csv";
import { dayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { TEMPLATE_HEADERS } from "@/lib/import/template";
import { leadWhere, parseLeadFilters } from "@/lib/leads/filters";
import { monthlyValue } from "@/lib/money";
import { getSetting } from "@/lib/settings";

/** Export prospects as CSV or Excel. Columns match the import template, so a file can be edited and re-imported. */
export async function GET(req: Request) {
  const user = await routeUser("VIEWER");
  if (user instanceof Response) return user;
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams);
  const ids = sp.ids ? sp.ids.split(",").filter(Boolean).slice(0, 5000) : null;
  const where = ids ? { id: { in: ids } } : leadWhere(parseLeadFilters(sp));
  const [companies, sales] = await Promise.all([
    db.company.findMany({ where, include: { contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, owner: { select: { name: true } } }, orderBy: { name: "asc" }, take: 20000 }),
    getSetting("sales"),
  ]);
  const value = (c: (typeof companies)[number], key: string): unknown => {
    const people = c.contacts;
    switch (key) {
      case "externalId": return c.externalId;
      case "name": return c.name;
      case "industry": return INDUSTRY_LABEL[c.industry] ?? c.industry;
      case "subindustry": return c.subindustry;
      case "businessStage": return c.businessStage === "UNKNOWN" ? "" : BUSINESS_STAGE_LABEL[c.businessStage];
      case "website": return c.website;
      case "streetAddress": return c.streetAddress;
      case "city": return c.city;
      case "state": return c.state;
      case "zip": return c.zip;
      case "location": return "";
      case "headquarters": return c.headquarters;
      case "additionalLocations": return c.additionalLocations.join("; ");
      case "employeeCount": return c.employeeCount;
      case "description": return c.description;
      case "ownershipType": return c.ownershipType;
      case "fundingStage": return c.fundingStage;
      case "growthIndicators": return c.growthIndicators;
      case "emails": return c.mainEmail;
      case "emailStatus": return c.mainEmail ? VERIFICATION_LABEL[c.mainEmailStatus] : "";
      case "phone": return c.mainPhone;
      case "phoneStatus": return c.mainPhone ? VERIFICATION_LABEL[c.mainPhoneStatus] : "";
      case "contactFormUrl": return c.contactFormUrl;
      case "preferredContactMethod": return c.preferredContactMethod === "UNKNOWN" ? "" : CONTACT_METHOD_LABEL[c.preferredContactMethod];
      case "contactNames": return people.map((p) => p.name).join("; ");
      case "contactRoles": return people.map((p) => p.title ?? "").join("; ");
      case "contactEmail": return people.map((p) => p.email ?? "").filter(Boolean).join("; ");
      case "contactPhone": return people.map((p) => p.phone ?? "").filter(Boolean).join("; ");
      case "linkedin": return people.map((p) => p.linkedinUrl ?? "").filter(Boolean).join("; ");
      case "priority": return PRIORITY_LABEL[c.priority];
      case "stage": return STAGE_LABEL[c.stage];
      case "lastContacted": return c.lastContactedAt ? dayKey(c.lastContactedAt) : "";
      case "managedUsers": return c.managedUsers;
      case "tags": return c.tags.join(", ");
      case "notes": return c.notes;
      case "source": return c.source;
      case "sourceUrl": return c.sourceUrl;
      case "personalNote": return c.personalNote;
      default: return "";
    }
  };
  const extraHeaders = ["Region", "Score", "Score is estimate", "Monthly estimate (USD)", "Next follow-up", "Owner", "Do not contact", "Archived", "Added"];
  const headers = [...TEMPLATE_HEADERS.map((h) => h.header), ...extraHeaders];
  const rows = companies.map((c) => [
    ...TEMPLATE_HEADERS.map((h) => value(c, h.key)),
    c.region ? REGION_LABEL[c.region] : "",
    c.score,
    c.scoreIsEstimate ? "Yes" : "No",
    monthlyValue(c, sales.pricePerUser),
    c.nextFollowUpAt ? c.nextFollowUpAt.toISOString() : "",
    c.owner?.name ?? "",
    c.doNotContact ? "Yes" : "No",
    c.archived ? "Yes" : "No",
    dayKey(c.createdAt),
  ]);
  await audit(user.id, "export.leads", undefined, { count: rows.length, format: sp.format ?? "csv" });
  const name = `prospects-${dayKey()}`;
  if (sp.format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Prospects");
    ws.addRow(headers);
    // ExcelJS stores these as text, not formulas; the prefix also guards copies pasted elsewhere.
    for (const r of rows) ws.addRow(r.map((v) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v)));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.columns.forEach((col) => (col.width = 18));
    const buf = await wb.xlsx.writeBuffer();
    return new Response(buf as ArrayBuffer, {
      headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}.xlsx"`, "cache-control": "private, no-store" },
    });
  }
  return csvResponse(`${name}.csv`, toCsv(headers, rows));
}
