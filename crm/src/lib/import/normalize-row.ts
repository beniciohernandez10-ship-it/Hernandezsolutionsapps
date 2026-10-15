import { CONTACT_METHODS, PIPELINE_STAGES, REGIONS } from "../constants";
import { normalizeEmail, normalizeState, normalizeWebsite, regionFor } from "../normalize";
import { mapIndustry } from "./industry";
import type { ColumnMapping, ImportFieldKey } from "./mapping";
import type { ImportContact, ImportRow, Method, Verification } from "./types";

const GENERIC_LOCAL = /^(info|hello|hi|contact|support|admin|office|sales|team|founders|marketing|partnerships|help|billing|accounts|frontdesk|reception|inquiries|enquiries|mail|general|careers|press|media|service|care)$/i;

function cell(record: Record<string, unknown>, mapping: ColumnMapping, key: ImportFieldKey): string | null {
  const header = mapping[key];
  if (!header) return null;
  const v = record[header];
  if (v === null || v === undefined) return null;
  const s = (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).replace(/ /g, " ").trim();
  if (!s || /^(n\/?a|none|null|missing|unknown|-|—|tbd)$/i.test(s)) return null;
  return s;
}

const split = (s: string | null) => (s ? s.split(/\s*[;\n|]\s*/).map((p) => p.trim()).filter(Boolean) : []);

export function parseVerification(raw: string | null, hasValue: boolean): Verification {
  if (!hasValue) return "UNKNOWN";
  const s = (raw ?? "").toLowerCase();
  if (/invalid|bounced|wrong|disconnected|bad/.test(s)) return "INVALID";
  if (/unverified|not verified|unconfirmed|needs? verif/.test(s)) return "UNVERIFIED";
  if (/verified|confirmed|valid/.test(s)) return "VERIFIED";
  // A value with no stated status was never verified.
  return "UNVERIFIED";
}

function parseMethod(raw: string | null, notes: string | null): Method {
  const s = `${raw ?? ""}`.toLowerCase();
  if (s) {
    if (/form|website/.test(s)) return "CONTACT_FORM";
    if (/e-?mail/.test(s)) return "EMAIL";
    if (/phone|call/.test(s)) return "PHONE";
    if (/linkedin/.test(s)) return "LINKEDIN";
    if (/person|visit|walk/.test(s)) return "IN_PERSON";
    const exact = CONTACT_METHODS.find((m) => m.label.toLowerCase() === s);
    if (exact) return exact.key;
  }
  // Source notes such as "Website contact" or "Contact via website" mean the contact route is the site's form.
  if (notes && /\b(website contact|contact via website|contact form|via (the )?website)\b/i.test(notes)) return "CONTACT_FORM";
  return "UNKNOWN";
}

function parsePriority(raw: string | null): "HIGH" | "MEDIUM" | "LOW" {
  const s = (raw ?? "").toLowerCase();
  if (/^(high|a|1|hot|top|p1)\b/.test(s)) return "HIGH";
  if (/^(low|c|3|cold|p3)\b/.test(s)) return "LOW";
  return "MEDIUM";
}

function parseStage(raw: string | null): string {
  if (!raw) return "NEW_LEAD";
  const s = raw.toLowerCase().replace(/[_-]+/g, " ").trim();
  const hit = PIPELINE_STAGES.find((p) => p.label.toLowerCase() === s || p.key.toLowerCase().replace(/_/g, " ") === s);
  // Anything else (including "drafted" or "email drafted") is not evidence of contact.
  return hit?.key ?? "NEW_LEAD";
}

function parseInt0(raw: string | null): number | null {
  if (!raw) return null;
  const range = /^(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)$/.exec(raw);
  if (range) return null; // a range is not a count; kept in notes instead
  const n = Number(raw.replace(/[,+~]/g, "").replace(/\s*(employees|people|staff)$/i, ""));
  return Number.isInteger(n) && n >= 0 && n < 10_000_000 ? n : null;
}

function parseDate(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "Casey: Co-founder / CEO; Michael: CTO" → per-name titles; a single role applies to everyone. */
function titlesFor(names: string[], rolesRaw: string | null): (string | null)[] {
  const parts = split(rolesRaw);
  if (!parts.length) return names.map(() => null);
  const keyed = parts.map((p) => /^([^:]+):\s*(.+)$/.exec(p));
  if (keyed.every(Boolean)) {
    return names.map((n) => {
      const first = n.split(/\s+/)[0].toLowerCase();
      const hit = keyed.find((k) => k && (k[1].trim().toLowerCase() === n.toLowerCase() || k[1].trim().toLowerCase() === first));
      return hit ? hit[2].trim() : null;
    });
  }
  if (parts.length === names.length) return parts;
  // One shared role ("Co-founders") applies to everyone, in the singular.
  if (parts.length === 1) return names.map(() => (names.length > 1 ? parts[0].replace(/(founder|partner|owner)s$/i, "$1") : parts[0]));
  return names.map(() => null);
}

/** Whose personal address is this? Matches "casey@", "stephen.meade@", "darren.m@" etc. to a contact name. */
function ownerOfEmail(email: string, names: string[]): number {
  const local = email.split("@")[0].toLowerCase();
  return names.findIndex((n) => {
    const [first, ...rest] = n.toLowerCase().split(/\s+/);
    const last = rest[rest.length - 1] ?? "";
    return local === first || local === `${first}.${last}` || local === `${first}${last}` || local === `${first[0]}${last}` || local === `${first}.${last[0]}` || (last && local === last);
  });
}


export function normalizeRecord(record: Record<string, unknown>, mapping: ColumnMapping, rowNumber: number, fileTags: string[] = []): ImportRow | { rowNumber: number; skip: string } {
  const name = cell(record, mapping, "name");
  if (!name) return { rowNumber, skip: "No company name" };
  const warnings: string[] = [];
  const noteParts: string[] = [];

  const industryRaw = cell(record, mapping, "industry");
  const { key: industry, matched } = mapIndustry(industryRaw);
  if (industryRaw && !matched) warnings.push(`Industry "${industryRaw}" didn't match a category; set to Other`);
  const subindustry = cell(record, mapping, "subindustry") ?? industryRaw;

  // Location: explicit city/state win; otherwise a "City, ST" location cell. Hedged text like "West LA / Beverly Hills area" stays as headquarters text only.
  let city = cell(record, mapping, "city");
  let state = normalizeState(cell(record, mapping, "state"));
  const location = cell(record, mapping, "location");
  let headquarters = cell(record, mapping, "headquarters");
  if (location && !city) {
    const m = /^([A-Za-z .'-]+?)(?:,\s*([A-Za-z .]{2,}))?(?:\s+\d{5})?$/.exec(location);
    if (m && !/\b(area|region|\/|or|near)\b/i.test(location)) {
      city = m[1].trim();
      if (m[2] && !state) state = normalizeState(m[2]);
    } else {
      headquarters ??= location;
      warnings.push(`Location "${location}" is not a single city; kept as text`);
    }
  }
  const region = REGIONS.some((r) => r.key === city) ? city : regionFor(city, state);

  // Emails: personal ones go to the matching contact, generic ones to the company.
  const names = split(cell(record, mapping, "contactNames"));
  const titles = titlesFor(names, cell(record, mapping, "contactRoles"));
  const emailCells = [...split(cell(record, mapping, "emails"))];
  const emailStatusRaw = cell(record, mapping, "emailStatus");
  const contactEmailCell = cell(record, mapping, "contactEmail");
  const contacts: ImportContact[] = names.map((n, i) => ({
    name: n,
    title: titles[i] ?? null,
    email: null,
    emailStatus: "UNKNOWN",
    phone: null,
    phoneStatus: "UNKNOWN",
    linkedinUrl: null,
    isDecisionMaker: false,
  }));
  // Personal addresses that match no named contact stay on the company record rather than on a guessed person.
  const genericEmails: string[] = [];
  const seen = new Set<string>();
  for (const raw of emailCells) {
    const e = normalizeEmail(raw);
    if (!e) {
      warnings.push(`Skipped "${raw}": not a valid email address`);
      continue;
    }
    if (seen.has(e)) continue;
    seen.add(e);
    const local = e.split("@")[0];
    const owner = GENERIC_LOCAL.test(local) ? -1 : ownerOfEmail(e, names);
    if (owner >= 0 && !contacts[owner].email) {
      contacts[owner].email = e;
      contacts[owner].emailStatus = parseVerification(emailStatusRaw, true);
    } else genericEmails.push(e);
  }
  if (contactEmailCell && contacts[0]) {
    const e = normalizeEmail(contactEmailCell);
    if (e && !contacts[0].email) {
      contacts[0].email = e;
      contacts[0].emailStatus = parseVerification(emailStatusRaw, true);
    }
  }
  const contactPhone = cell(record, mapping, "contactPhone");
  if (contactPhone && contacts[0]) {
    contacts[0].phone = contactPhone;
    contacts[0].phoneStatus = parseVerification(cell(record, mapping, "phoneStatus"), true);
  }
  const linkedin = cell(record, mapping, "linkedin");
  if (linkedin && contacts[0]) contacts[0].linkedinUrl = linkedin;

  const website = normalizeWebsite(cell(record, mapping, "website"));
  const mainEmail = genericEmails[0] ?? null;
  if (genericEmails.length > 1) noteParts.push(`Other emails on record: ${genericEmails.slice(1).join(", ")}`);
  const phoneRaw = cell(record, mapping, "phone");
  const phones = split(phoneRaw);
  if (phones.length > 1) noteParts.push(`Other phones on record: ${phones.slice(1).join(", ")}`);

  const notes = cell(record, mapping, "notes");
  const aliases = cell(record, mapping, "aliases");
  if (aliases) noteParts.push(`Also known as: ${aliases}`);
  const sourceRef = cell(record, mapping, "sourceRef");
  if (sourceRef) noteParts.push(`Source reference: ${sourceRef}`);
  const verificationNote = cell(record, mapping, "verificationNote");
  if (verificationNote) noteParts.push(`Verification: ${verificationNote}`);
  const locationStatus = cell(record, mapping, "locationStatus");
  if (locationStatus) noteParts.push(`Location status: ${locationStatus}`);
  const missingFields = cell(record, mapping, "missingFields");
  if (missingFields) noteParts.push(`Missing in source: ${missingFields}`);
  const coverage = cell(record, mapping, "coverage");
  if (coverage) noteParts.push(`Coverage: ${coverage}`);
  const empRaw = cell(record, mapping, "employeeCount");
  const employeeCount = parseInt0(empRaw);
  if (empRaw && employeeCount === null) noteParts.push(`Employee count in source: ${empRaw}`);
  const lastContactedAt = parseDate(cell(record, mapping, "lastContacted"));

  const source = cell(record, mapping, "source");
  const stageRaw = cell(record, mapping, "stage");
  let stage = parseStage(stageRaw);
  if (lastContactedAt && ["NEW_LEAD", "RESEARCHING", "READY_TO_CONTACT"].includes(stage)) stage = "CONTACTED";
  if (stageRaw && stage === "NEW_LEAD" && !/^new/i.test(stageRaw)) noteParts.push(`Status in source: ${stageRaw}`);

  const stageText = cell(record, mapping, "businessStage");
  const businessStage: ImportRow["businessStage"] = stageText
    ? /startup|start-up|seed|series|early/i.test(stageText) ? "STARTUP" : /established|mature|private|family|public/i.test(stageText) ? "ESTABLISHED" : "UNKNOWN"
    : source && /\bstart-?ups?\b/i.test(source) ? "STARTUP" : "UNKNOWN";

  const tags = new Set<string>(fileTags);
  for (const t of split(cell(record, mapping, "tags")).flatMap((t) => t.split(","))) if (t.trim()) tags.add(t.trim().toLowerCase());
  if (source) tags.add(source.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40));

  const emailStatus = parseVerification(emailStatusRaw, !!mainEmail);

  return {
    rowNumber,
    externalId: cell(record, mapping, "externalId"),
    name: name.slice(0, 200),
    industry,
    subindustry,
    businessStage,
    website,
    streetAddress: cell(record, mapping, "streetAddress"),
    city,
    state,
    zip: cell(record, mapping, "zip"),
    headquarters,
    region,
    employeeCount,
    employeeCountSource: employeeCount !== null ? (source ? `Import: ${source}` : "Import") : null,
    description: cell(record, mapping, "description"),
    ownershipType: cell(record, mapping, "ownershipType"),
    fundingStage: cell(record, mapping, "fundingStage"),
    growthIndicators: cell(record, mapping, "growthIndicators"),
    mainEmail,
    mainEmailStatus: emailStatus,
    mainPhone: phones[0] ?? null,
    mainPhoneStatus: parseVerification(cell(record, mapping, "phoneStatus"), !!phones[0]),
    contactFormUrl: cell(record, mapping, "contactFormUrl"),
    preferredContactMethod: parseMethod(cell(record, mapping, "preferredContactMethod"), notes),
    contacts,
    priority: parsePriority(cell(record, mapping, "priority")),
    stage,
    lastContactedAt,
    managedUsers: parseInt0(cell(record, mapping, "managedUsers")),
    tags: [...tags].filter(Boolean),
    notes: [notes, ...noteParts].filter(Boolean).join("\n") || null,
    source,
    sourceUrl: cell(record, mapping, "sourceUrl"),
    personalNote: cell(record, mapping, "personalNote"),
    warnings,
  };
}
