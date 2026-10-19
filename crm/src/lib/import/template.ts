import { IMPORT_FIELDS } from "./mapping";

const HELP: Partial<Record<(typeof IMPORT_FIELDS)[number]["key"], string>> = {
  externalId: "Your own ID for the lead, if any. Re-importing the same ID updates instead of duplicating.",
  name: "Required. The business name.",
  industry: "Any wording; it's matched to the CRM's industries and the original text is kept.",
  businessStage: "Startup or Established. Leave blank if unknown.",
  emails: "Business email(s). Separate several with a comma. Personal addresses are matched to the contact they belong to.",
  emailStatus: "Verified, Unverified or Unknown. Leave blank if you haven't checked.",
  phoneStatus: "Verified, Unverified or Unknown.",
  contactNames: "One or more names separated by commas or semicolons.",
  contactRoles: "Titles in the same order as the names.",
  stage: "Leave blank for New Lead. Only set a contacted stage if outreach really happened.",
  lastContacted: "Date of the last real outreach (YYYY-MM-DD).",
  notes: "Anything else. Website contact-form outreach can be noted here.",
};

const HEADER: Partial<Record<string, string>> = { externalId: "Lead ID", sourceUrl: "Source URL", linkedin: "LinkedIn", contactFormUrl: "Contact Form URL", zip: "ZIP" };

export const TEMPLATE_EXAMPLE: Record<string, string> = {
  name: "Example Dental Group",
  industry: "Private healthcare",
  subindustry: "Dentistry",
  businessStage: "Established",
  website: "https://example.com",
  city: "Irvine",
  state: "CA",
  emails: "office@example.com",
  emailStatus: "Unverified",
  phone: "(949) 555-0100",
  phoneStatus: "Unverified",
  preferredContactMethod: "Phone",
  contactNames: "Jordan Lee",
  contactRoles: "Office Manager",
  priority: "Medium",
  notes: "Delete this example row before importing.",
};

/** Headers for the import template and lead exports; each one is recognized by autoMap. */
export const TEMPLATE_HEADERS = IMPORT_FIELDS.filter((f) => !["sourceRef", "missingFields", "verificationNote", "locationStatus", "coverage", "aliases"].includes(f.key)).map((f) => ({
  key: f.key,
  header: HEADER[f.key] ?? f.synonyms[0].replace(/\b\w/g, (c) => c.toUpperCase()),
  help: HELP[f.key] ?? f.label,
}));
