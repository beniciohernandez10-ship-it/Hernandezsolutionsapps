import { describe, expect, it } from "vitest";
import { autoMap } from "@/lib/import/mapping";
import { looksLikeSpreadsheet, PASTE_COLUMNS, pastedLeadsToCsv, sortPastedLeads } from "@/lib/import/paste";

describe("sortPastedLeads", () => {
  it("sorts a directory-style block per business", () => {
    const [a, b] = sortPastedLeads(`Bayview Animal Hospital
Dr. Maria Lopez, DVM - Owner
1234 Main St, Oakland, CA 94607
(510) 555-0142
info@bayviewvet.com
www.bayviewvet.com

Harbor Law Group LLP
Contact: James Chen (Managing Partner)
Email: jchen@harborlaw.com
Phone: 415-555-0199
San Francisco, CA`);
    expect(a).toMatchObject({
      company: "Bayview Animal Hospital",
      contactName: "Dr. Maria Lopez",
      street: "1234 Main St",
      city: "Oakland",
      state: "CA",
      zip: "94607",
      phone: "(510) 555-0142",
      email: "info@bayviewvet.com",
      website: "www.bayviewvet.com",
      businessField: "Veterinary practices",
      fieldInferred: true,
    });
    expect(a.title).toMatch(/Owner|DVM/);
    expect(b).toMatchObject({
      company: "Harbor Law Group LLP",
      contactName: "James Chen",
      title: "Managing Partner",
      email: "jchen@harborlaw.com",
      phone: "415-555-0199",
      city: "San Francisco",
      state: "CA",
    });
  });

  it("reads one business per line", () => {
    const rows = sortPastedLeads(`Summit CPA Group | Accounting | Walnut Creek, CA | 925-555-0101 | hello@summitcpa.com
Pacific Dental Care - Dental - Fremont, California - (510) 555-0177`);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ company: "Summit CPA Group", businessField: "Accounting", fieldInferred: false, city: "Walnut Creek", state: "CA", email: "hello@summitcpa.com" });
    expect(rows[1]).toMatchObject({ company: "Pacific Dental Care", city: "Fremont", state: "CA", phone: "(510) 555-0177" });
  });

  it("splits consecutive businesses without blank lines", () => {
    const rows = sortPastedLeads(`Acme Construction Inc
contact@acmebuild.com
Brightline Staffing
(213) 555-0123`);
    expect(rows.map((r) => r.company)).toEqual(["Acme Construction Inc", "Brightline Staffing"]);
    expect(rows[1].phone).toBe("(213) 555-0123");
  });

  it("never invents missing details", () => {
    const [r] = sortPastedLeads("Riverside Holdings\nsales@riverside.co");
    expect(r).toMatchObject({ company: "Riverside Holdings", contactName: "", city: "", phone: "", email: "sales@riverside.co" });
  });

  it("keeps multiple emails and phones", () => {
    const [r] = sortPastedLeads("Northgate Clinic\nfront@northgate.com, billing@northgate.com\n510-555-0100 / 510-555-0101");
    expect(r.email).toBe("front@northgate.com; billing@northgate.com");
    expect(r.phone).toBe("510-555-0100; 510-555-0101");
  });

  it("ignores empty input", () => {
    expect(sortPastedLeads("  \n\n ")).toEqual([]);
  });
});

describe("pasted lead CSV", () => {
  it("uses headers the importer maps automatically", () => {
    const mapping = autoMap(PASTE_COLUMNS.map((c) => c.header));
    expect(Object.keys(mapping).sort()).toEqual(
      ["name", "contactNames", "contactRoles", "industry", "city", "state", "emails", "phone", "website", "streetAddress", "zip", "linkedin", "notes"].sort(),
    );
  });

  it("quotes values with commas and quotes", () => {
    const csv = pastedLeadsToCsv(sortPastedLeads('Smith, Jones & Co\nnote: said "call back"\ninfo@sjco.com'));
    expect(csv.split("\r\n")[1]).toContain('"Smith, Jones & Co"');
    expect(csv).toContain('"said ""call back"""');
  });
});

describe("looksLikeSpreadsheet", () => {
  it("detects tab separated rows with a header", () => {
    expect(looksLikeSpreadsheet("Company\tCity\tEmail\nA\tB\tc@d.com\nE\tF\tg@h.com")).toBe(true);
    expect(looksLikeSpreadsheet("Acme Inc\ninfo@acme.com")).toBe(false);
  });
});
