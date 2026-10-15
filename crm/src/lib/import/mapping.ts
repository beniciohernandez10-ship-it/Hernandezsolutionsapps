/** Target fields an import column can map to, with header names we recognize automatically. */
export const IMPORT_FIELDS = [
  { key: "externalId", label: "Lead ID (from your list)", synonyms: ["lead id", "id", "record id", "external id", "lead #"] },
  { key: "name", label: "Company name", synonyms: ["company name", "company", "business name", "business", "organization", "account name", "practice name", "firm"] },
  { key: "aliases", label: "Other names / aliases", synonyms: ["aliases", "alias", "dba", "also known as", "other names"] },
  { key: "industry", label: "Industry", synonyms: ["industry", "vertical", "sector", "category", "segment"] },
  { key: "subindustry", label: "Subindustry", synonyms: ["subindustry", "sub-industry", "sub industry", "niche", "specialty"] },
  { key: "businessStage", label: "Startup or established", synonyms: ["startup or established", "company type", "business stage", "stage of business", "startup"] },
  { key: "website", label: "Website", synonyms: ["website", "web site", "url", "company website", "domain", "site"] },
  { key: "streetAddress", label: "Street address", synonyms: ["street address", "address", "street", "address 1", "address line 1"] },
  { key: "city", label: "City", synonyms: ["city", "town"] },
  { key: "state", label: "State", synonyms: ["state", "st", "province"] },
  { key: "zip", label: "ZIP code", synonyms: ["zip", "zip code", "zipcode", "postal code", "postcode"] },
  { key: "location", label: "Location (\"City, ST\")", synonyms: ["location", "city, state", "city/state", "area"] },
  { key: "headquarters", label: "Headquarters", synonyms: ["headquarters", "hq", "hq location"] },
  { key: "additionalLocations", label: "Additional locations", synonyms: ["additional locations", "other locations", "locations"] },
  { key: "employeeCount", label: "Employee count", synonyms: ["employee count", "employees", "estimated employees", "headcount", "# employees", "company size", "size"] },
  { key: "description", label: "Company description", synonyms: ["description", "company description", "about", "summary"] },
  { key: "ownershipType", label: "Ownership type", synonyms: ["ownership", "ownership type"] },
  { key: "fundingStage", label: "Funding stage", synonyms: ["funding", "funding stage", "round", "funding round"] },
  { key: "growthIndicators", label: "Growth indicators", synonyms: ["growth indicators", "growth", "signals", "growth signals"] },
  { key: "emails", label: "Email(s)", synonyms: ["emails", "email", "email address", "main email", "business email", "general email", "e-mail"] },
  { key: "emailStatus", label: "Email status", synonyms: ["email status", "email verified", "email verification"] },
  { key: "phone", label: "Phone", synonyms: ["phone", "main phone", "phone number", "business phone", "telephone", "tel"] },
  { key: "phoneStatus", label: "Phone status", synonyms: ["phone status", "phone verified", "phone verification"] },
  { key: "contactFormUrl", label: "Contact form URL", synonyms: ["contact form", "contact form url", "contact page"] },
  { key: "preferredContactMethod", label: "Preferred contact method", synonyms: ["preferred contact method", "contact method", "best way to contact"] },
  { key: "contactNames", label: "Contact name(s)", synonyms: ["contact names", "contact name", "contact", "contact person", "decision maker", "decision-maker", "owner name", "founders"] },
  { key: "contactRoles", label: "Contact title(s)", synonyms: ["contact roles", "contact role", "title", "contact title", "job title", "role", "position"] },
  { key: "contactEmail", label: "Contact direct email", synonyms: ["direct email", "contact email", "personal email"] },
  { key: "contactPhone", label: "Contact direct phone", synonyms: ["direct phone", "contact phone", "mobile", "cell"] },
  { key: "linkedin", label: "LinkedIn profile", synonyms: ["linkedin", "linkedin url", "linkedin profile"] },
  { key: "priority", label: "Priority", synonyms: ["priority", "lead priority", "tier"] },
  { key: "stage", label: "Status / stage", synonyms: ["status", "lead status", "stage", "pipeline stage"] },
  { key: "lastContacted", label: "Last contacted date", synonyms: ["last contacted", "last contact", "date contacted", "contacted on"] },
  { key: "managedUsers", label: "Managed users (estimate)", synonyms: ["managed users", "users", "seats", "user count"] },
  { key: "tags", label: "Tags", synonyms: ["tags", "labels", "list"] },
  { key: "notes", label: "Notes", synonyms: ["notes", "note", "comments", "research notes"] },
  { key: "source", label: "Source", synonyms: ["source list", "source", "lead source", "list name"] },
  { key: "sourceUrl", label: "Source URL", synonyms: ["source conversation", "source url", "source link", "reference url"] },
  { key: "sourceRef", label: "Source reference", synonyms: ["source message ids", "source reference", "source ids"] },
  { key: "missingFields", label: "Missing fields (note)", synonyms: ["missing fields", "missing"] },
  { key: "verificationNote", label: "Verification note", synonyms: ["verification status", "verification", "verification note"] },
  { key: "locationStatus", label: "Location status", synonyms: ["location status"] },
  { key: "coverage", label: "Coverage note", synonyms: ["coverage"] },
  { key: "personalNote", label: "Opening line / personal note", synonyms: ["personal note", "opening line", "personalization", "icebreaker"] },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];
export type ColumnMapping = Partial<Record<ImportFieldKey, string>>;

const clean = (h: string) => h.toLowerCase().replace(/^﻿/, "").replace(/[_\s]+/g, " ").replace(/[^\w #/,-]/g, "").trim();

/** Map spreadsheet headers to fields by exact synonym, so each header is used at most once. */
export function autoMap(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  for (const field of IMPORT_FIELDS) {
    const hit = headers.find((h) => !used.has(h) && (field.synonyms as readonly string[]).includes(clean(h)));
    if (hit) {
      mapping[field.key] = hit;
      used.add(hit);
    }
  }
  return mapping;
}
