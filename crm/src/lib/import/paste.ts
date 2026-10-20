import { INDUSTRY_LABEL } from "../constants";
import { mapIndustry } from "./industry";

/**
 * Sorts pasted, unstructured lead text (copied from a website, a directory, an email or a note)
 * into import columns. Only text that is actually in the paste is used: the one inference is
 * the business field, which may be read from the company name and is flagged as such.
 */
export interface PastedLead {
  company: string;
  contactName: string;
  title: string;
  businessField: string;
  /** True when the business field was read from the company name rather than stated. */
  fieldInferred: boolean;
  street: string;
  city: string;
  state: string;
  zip: string;
  email: string;
  phone: string;
  website: string;
  linkedin: string;
  notes: string;
}

/** Column headers the importer's auto-mapping recognizes (see mapping.ts synonyms). */
export const PASTE_COLUMNS: { key: keyof Omit<PastedLead, "fieldInferred">; header: string; label: string }[] = [
  { key: "company", header: "Company name", label: "Company" },
  { key: "contactName", header: "Contact name", label: "Contact" },
  { key: "title", header: "Contact title", label: "Title" },
  { key: "businessField", header: "Industry", label: "Business field" },
  { key: "city", header: "City", label: "City" },
  { key: "state", header: "State", label: "State" },
  { key: "email", header: "Email", label: "Email" },
  { key: "phone", header: "Phone", label: "Phone" },
  { key: "website", header: "Website", label: "Website" },
  { key: "street", header: "Street address", label: "Street" },
  { key: "zip", header: "ZIP code", label: "ZIP" },
  { key: "linkedin", header: "LinkedIn", label: "LinkedIn" },
  { key: "notes", header: "Notes", label: "Notes" },
];

export const MAX_PASTE_CHARS = 200_000;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b(?:\s*(?:x|ext\.?|extension)\s*\d{1,5})?/gi;
const URL = /\b(?:https?:\/\/|www\.)[^\s,;|<>"]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|ai|us|biz|info|health|vet|law|dental|app|dev|tech)(?:\/[^\s,;|<>"]*)?\b/gi;
const ZIP = /\b\d{5}(?:-\d{4})?\b/;
const STREET = /^\d+[A-Za-z]?\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9 .'-]+?\b(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court|pl|place|pkwy|parkway|hwy|highway|ter|terrace|cir|circle|sq|square|plaza|trl|trail)\b\.?(?:\s*(?:#|suite|ste\.?|unit|apt\.?|fl\.?|floor)\s*[\w-]+)?/i;

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const STATE_CODES = new Set(Object.values(STATES));

const TITLE = /\b(owner|co-?founder|founder|ceo|cto|cfo|coo|cio|ciso|president|vice president|vp|partner|principal|director|manager|administrator|head of|lead|officer|chief|controller|dvm|md|dds|dmd|cpa|esq|attorney|office manager|practice manager|it manager|operations)\b/i;
const BUSINESS = /\b(llc|inc|corp|co\b|company|group|clinic|hospital|practice|associates|partners|firm|law|labs?|studio|solutions|services|systems|technologies|tech|health|medical|dental|veterinary|animal|capital|ventures|holdings|agency|consulting|center|centre|cpa|accounting|realty|properties|construction|engineering|insurance|\.com)\b/i;
const PERSON = /^(?:(?:Dr|Mr|Mrs|Ms|Mx)\.?\s+)?[A-Z][a-z'’-]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-z'’-]+){1,2}(?:,?\s+(?:Jr|Sr|II|III|MD|DVM|DDS|CPA|Esq)\.?)?$/;
/** Reads as a business rather than a person ("Brightline Staffing", "Acme LLC"). */
const businessy = (s: string) => BUSINESS.test(s) || mapIndustry(s).matched;

type Label = "company" | "contact" | "title" | "field" | "email" | "phone" | "website" | "address" | "city" | "state" | "zip" | "linkedin" | "notes";
const LABELS: [RegExp, Label][] = [
  [/^(?:company|business|business name|company name|organization|practice|firm|account)$/i, "company"],
  [/^(?:contact|contact name|name|owner|decision maker|person|point of contact|poc)$/i, "contact"],
  [/^(?:title|role|position|job title)$/i, "title"],
  [/^(?:industry|business field|field|category|type|sector|vertical|specialty)$/i, "field"],
  [/^(?:e-?mail|email address)$/i, "email"],
  [/^(?:phone|tel|telephone|mobile|cell|phone number|office)$/i, "phone"],
  [/^(?:website|web|site|url|domain)$/i, "website"],
  [/^(?:address|street|street address|location)$/i, "address"],
  [/^(?:city|town)$/i, "city"],
  [/^(?:state|province)$/i, "state"],
  [/^(?:zip|zip code|postal code)$/i, "zip"],
  [/^linkedin$/i, "linkedin"],
  [/^(?:notes?|comments?|about|description)$/i, "notes"],
];

const empty = (): PastedLead => ({
  company: "", contactName: "", title: "", businessField: "", fieldInferred: false, street: "", city: "", state: "", zip: "",
  email: "", phone: "", website: "", linkedin: "", notes: "",
});

const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s,;:|•·*-]+|[\s,;:|•·*-]+$/g, "").trim();
const stateCode = (s: string) => {
  const t = s.trim().replace(/\.$/, "");
  if (STATE_CODES.has(t.toUpperCase()) && t.length === 2) return t.toUpperCase();
  return STATES[t.toLowerCase()] ?? null;
};
const append = (a: string, b: string, sep = "; ") => (a ? (b && !a.includes(b) ? `${a}${sep}${b}` : a) : b);

/** "Oakland, CA 94607", "Oakland CA", "Oakland, California" → parts, or null. */
function cityState(text: string): { city: string; state: string; zip: string } | null {
  const zip = ZIP.exec(text)?.[0] ?? "";
  const t = text.replace(ZIP, "").replace(/,?\s*(?:usa|united states)\.?$/i, "").trim().replace(/,$/, "");
  const m = /^([A-Za-z .'-]+?)\s*,?\s+([A-Za-z .]+)$/.exec(t);
  if (!m) return null;
  const state = stateCode(m[2]);
  if (!state || m[1].trim().split(/\s+/).length > 4) return null;
  return { city: m[1].trim(), state, zip };
}

/** Pull emails, phones and links out of any text, returning what's left. */
function extract(text: string, lead: PastedLead): string {
  let rest = text;
  for (const e of rest.match(EMAIL) ?? []) lead.email = append(lead.email, e.toLowerCase());
  rest = rest.replace(EMAIL, " ");
  for (const p of rest.match(PHONE) ?? []) lead.phone = append(lead.phone, p.trim());
  rest = rest.replace(PHONE, " ");
  for (const u of rest.match(URL) ?? []) {
    const url = u.replace(/[.)]+$/, "");
    if (/linkedin\.com/i.test(url)) lead.linkedin ||= url;
    else lead.website ||= url;
  }
  return rest.replace(URL, " ");
}

/** Street / city / state / zip from an address-looking piece. Returns true if it was one. */
function address(piece: string, lead: PastedLead): boolean {
  const street = STREET.exec(piece);
  if (street && street.index === 0) {
    lead.street ||= tidy(street[0]);
    const rest = tidy(piece.slice(street[0].length));
    const cs = rest ? cityState(rest) : null;
    if (cs) Object.assign(lead, { city: lead.city || cs.city, state: lead.state || cs.state, zip: lead.zip || cs.zip });
    else if (ZIP.test(rest)) lead.zip ||= ZIP.exec(rest)![0];
    return true;
  }
  const cs = cityState(piece);
  if (cs) {
    lead.city ||= cs.city;
    lead.state ||= cs.state;
    lead.zip ||= cs.zip;
    return true;
  }
  return false;
}

function labelled(piece: string): { label: Label; value: string } | null {
  const m = /^([A-Za-z][A-Za-z /-]{1,24}?)\s*[:=]\s*(.+)$/.exec(piece);
  if (!m) return null;
  const hit = LABELS.find(([re]) => re.test(m[1].trim()));
  return hit ? { label: hit[1], value: m[2].trim() } : null;
}

/** "Jane Doe, Owner" / "Jane Doe - Practice Manager" / "Dr. Jane Doe (DVM)" → name + title. */
function personWithTitle(piece: string): { name: string; title: string } | null {
  const m = /^(.+?)\s*(?:,|\(|\s[-–—]\s|\/)\s*([^)]+)\)?$/.exec(piece);
  if (m && PERSON.test(m[1].trim()) && TITLE.test(m[2])) return { name: m[1].trim(), title: tidy(m[2]) };
  const m2 = /^(.+?)\s*(?:,|\s[-–—]\s)\s*(.+)$/.exec(piece);
  if (m2 && TITLE.test(m2[1]) && PERSON.test(m2[2].trim())) return { name: m2[2].trim(), title: tidy(m2[1]) };
  return null;
}

function applyLabel(lead: PastedLead, label: Label, value: string) {
  const v = tidy(value);
  if (!v) return;
  switch (label) {
    case "company": lead.company ||= v; break;
    case "contact": {
      const pt = personWithTitle(v);
      if (pt) { lead.contactName ||= pt.name; lead.title ||= pt.title; } else lead.contactName ||= v;
      break;
    }
    case "title": lead.title ||= v; break;
    case "field": lead.businessField ||= v; break;
    case "email": case "phone": case "website": case "linkedin": {
      const left = tidy(extract(v, lead));
      if (label === "website" && left && !lead.website) lead.website = left;
      break;
    }
    case "address": if (!address(v, lead)) lead.notes = append(lead.notes, `Address: ${v}`); break;
    case "city": lead.city ||= v; break;
    case "state": lead.state ||= stateCode(v) ?? v; break;
    case "zip": lead.zip ||= v; break;
    case "notes": lead.notes = append(lead.notes, v); break;
  }
}

function fromBlock(lines: string[]): PastedLead {
  const lead = empty();
  const loose: string[] = [];
  for (const line of lines) {
    const whole = labelled(line);
    if (whole) { applyLabel(lead, whole.label, whole.value); continue; }
    // Keep "Street, City, ST 12345" together before splitting on separators.
    const stripped = tidy(extract(line, lead));
    if (!stripped) continue;
    if (address(stripped, lead)) continue;
    for (const raw of stripped.split(/\s+[|•·–—]\s+|\s+-\s+|\t|;|\s{2,}/)) {
      const piece = tidy(raw);
      if (!piece) continue;
      const lab = labelled(piece);
      if (lab) applyLabel(lead, lab.label, lab.value);
      else if (!address(piece, lead)) loose.push(piece);
    }
  }

  for (const piece of loose) {
    const pt = personWithTitle(piece);
    if (pt && !lead.contactName) { lead.contactName = pt.name; lead.title ||= pt.title; continue; }
    if (!lead.company && (businessy(piece) || !PERSON.test(piece))) { lead.company = piece; continue; }
    if (!lead.contactName && PERSON.test(piece) && !businessy(piece)) { lead.contactName = piece; continue; }
    if (lead.contactName && TITLE.test(piece) && piece.split(/\s+/).length <= 5) { lead.title = append(lead.title, piece, ", "); continue; }
    if (!lead.businessField && piece.split(/\s+/).length <= 5 && mapIndustry(piece).matched) { lead.businessField = piece; continue; }
    if (!lead.company) { lead.company = piece; continue; }
    lead.notes = append(lead.notes, piece);
  }

  // Not stated: read it from the company name, and flag it so the review table shows it as a guess.
  if (!lead.businessField) {
    const guess = mapIndustry(`${lead.company} ${lead.notes}`);
    if (guess.matched) { lead.businessField = INDUSTRY_LABEL[guess.key] ?? ""; lead.fieldInferred = true; }
  }
  return lead;
}

const hasContact = (l: PastedLead) => !!(l.email || l.phone || l.website);
const lineHasContact = (s: string) => new RegExp(EMAIL.source, "i").test(s) || new RegExp(PHONE.source, "i").test(s);

/** Split pasted text into one block of lines per business. */
function blocks(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);
  if (!nonEmpty.length) return [];
  // Blank lines separate businesses.
  if (lines.some((l, i) => !l && i > 0 && lines[i - 1])) {
    const out: string[][] = [];
    let cur: string[] = [];
    for (const l of lines) {
      if (l) cur.push(l);
      else if (cur.length) { out.push(cur); cur = []; }
    }
    if (cur.length) out.push(cur);
    return out;
  }
  // One business per line (each line carries its own email/phone).
  if (nonEmpty.length > 1 && nonEmpty.every(lineHasContact)) return nonEmpty.map((l) => [l]);
  // Otherwise a new business starts at a plain line once the current one already has contact details.
  const out: string[][] = [];
  let cur: string[] = [];
  let probe = empty();
  for (const l of nonEmpty) {
    const plain = !lineHasContact(l) && !labelled(l) && !STREET.test(l) && !cityState(l);
    if (cur.length && plain && hasContact(probe) && (businessy(l) || !PERSON.test(l)) && !TITLE.test(l)) {
      out.push(cur);
      cur = [];
      probe = empty();
    }
    cur.push(l);
    extract(l, probe);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** True when the paste looks like rows copied from a spreadsheet (tab separated with a header row). */
export function looksLikeSpreadsheet(text: string): boolean {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return false;
  const cols = lines[0].split("\t").length;
  return cols >= 3 && lines.slice(0, 20).every((l) => l.split("\t").length === cols);
}

export function sortPastedLeads(text: string): PastedLead[] {
  if (text.length > MAX_PASTE_CHARS) throw new Error("That's a lot of text. Paste up to about 200,000 characters at a time.");
  return blocks(text)
    .map(fromBlock)
    .filter((l) => l.company || l.contactName || l.email || l.phone)
    .map((l) => (l.company || !l.contactName ? l : { ...l, notes: append(l.notes, "No business name in the paste") }));
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The reviewed rows as CSV for the normal import pipeline (duplicate checks, report, audit). */
export function pastedLeadsToCsv(leads: PastedLead[]): string {
  const head = PASTE_COLUMNS.map((c) => c.header).join(",");
  const body = leads.map((l) => PASTE_COLUMNS.map((c) => csvCell(l[c.key])).join(","));
  return [head, ...body].join("\r\n");
}
