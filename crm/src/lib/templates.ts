import { INDUSTRY_LABEL } from "./constants";

/**
 * Email templates and call scripts.
 *
 * Merge fields use {{double braces}}. Rendering fills what it can; anything left unresolved
 * (an unknown field, or a [[bracketed note]] the writer must replace) blocks sending, so an
 * email never goes out with a placeholder in it.
 *
 * Writing rules the built-in templates follow:
 * - Don't assume the prospect uses Microsoft; mention the Microsoft 365 check only as an "if".
 * - Never imply their security is poor. Offer a second set of eyes, not a rescue.
 * - Tech startups: complement the engineering team, don't replace it.
 * - Small companies: never suggest they are too small to afford IT.
 * - No made-up client names, case studies or statistics.
 */

export const MERGE_FIELDS = [
  { key: "firstName", label: "Contact first name", fallback: "there" },
  { key: "contactName", label: "Contact full name", fallback: "" },
  { key: "contactTitle", label: "Contact title", fallback: "" },
  { key: "companyName", label: "Company name", fallback: null },
  { key: "city", label: "City", fallback: "" },
  { key: "industry", label: "Industry", fallback: "" },
  { key: "personalNote", label: "Personal opening line (removed when blank)", fallback: "" },
  { key: "senderName", label: "Your name", fallback: null },
  { key: "senderCompany", label: "Your company", fallback: null },
  { key: "website", label: "Your website", fallback: "" },
  { key: "senderPhone", label: "Your phone number", fallback: "this number" },
] as const;

export type MergeKey = (typeof MERGE_FIELDS)[number]["key"];
export type MergeData = Partial<Record<MergeKey, string | null | undefined>>;

const FIELD_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;
const NOTE_RE = /\[\[[^\]]*\]\]/g;

/**
 * Fill merge fields. A line whose only content is a blank optional field is dropped,
 * so a missing personal note doesn't leave an empty paragraph.
 */
export function renderTemplate(text: string, data: MergeData): string {
  const known = new Map<string, (typeof MERGE_FIELDS)[number]>(MERGE_FIELDS.map((f) => [f.key, f]));
  const lines = text.split("\n").map((line) => {
    let blankOptional = false;
    let hadField = false;
    const out = line.replace(FIELD_RE, (whole, key: string) => {
      const field = known.get(key);
      if (!field) return whole;
      hadField = true;
      const value = (data[key as MergeKey] ?? "").toString().trim();
      if (value) return value;
      if (field.fallback === null) return whole;
      if (field.fallback === "") blankOptional = true;
      return field.fallback;
    });
    if (hadField && blankOptional && out.replace(/[\s.,;:!-]/g, "") === "") return null;
    return out;
  });
  return lines
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Placeholders that would go out as-is if sent. Empty means the text is ready. */
export function unresolvedPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(FIELD_RE)) found.add(m[0]);
  for (const m of text.matchAll(NOTE_RE)) found.add(m[0]);
  return [...found];
}

export function firstNameOf(name: string | null | undefined): string {
  if (!name) return "";
  const cleaned = name.replace(/^(dr|mr|mrs|ms|mx)\.?\s+/i, "").trim();
  return cleaned.split(/\s+/)[0] ?? "";
}

export function mergeDataFor(input: {
  company: { name: string; city: string | null; industry: string; personalNote: string | null };
  contact?: { name: string; title: string | null } | null;
  sender: { senderName: string; companyName: string; website: string; senderPhone?: string };
}): MergeData {
  return {
    firstName: firstNameOf(input.contact?.name),
    contactName: input.contact?.name ?? "",
    contactTitle: input.contact?.title ?? "",
    companyName: input.company.name,
    city: input.company.city ?? "",
    industry: INDUSTRY_LABEL[input.company.industry] ?? "",
    personalNote: input.company.personalNote ?? "",
    senderName: input.sender.senderName,
    senderCompany: input.sender.companyName,
    website: input.sender.website,
    senderPhone: input.sender.senderPhone ?? "",
  };
}

/** Signature, postal address and opt-out line added to every outgoing email. */
export function emailFooter(o: { signature: string; mailingAddress: string; optOutLine: string; senderName: string }): string {
  const sign = [o.senderName.trim(), o.signature.trim()].filter(Boolean).join("\n");
  const legal = [o.mailingAddress.trim(), o.optOutLine.trim()].filter(Boolean).join("\n");
  return [sign, legal].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// Built-in content (seeded once; editable afterwards in Email Outreach → Templates)
// ---------------------------------------------------------------------------

export interface BuiltInTemplate {
  /** Stable key so the seed can update its own templates without touching user-made ones. */
  key: string;
  channel: "EMAIL" | "CALL_SCRIPT";
  name: string;
  /** Industry keys this template is the first-touch email for. */
  industries: string[];
  subject: string;
  body: string;
}

const CLOSE = `Would a short call next week be useful? If you're on Microsoft 365, I'm also happy to do a free 15-minute security check and send you what I find, with no obligation.

Thanks,`;

const SERVICES_LINE = "Our services include Microsoft 365 and Azure administration, identity and access management, device management, help desk support, onboarding and offboarding, and backup and recovery.";

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    key: "tech-startup",
    channel: "EMAIL",
    name: "Tech startups (general)",
    industries: ["startup_general", "proptech", "legaltech", "insurtech"],
    subject: "IT support that works alongside your engineers at {{companyName}}",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. We take the business IT off your engineers' plates: laptops and device setup, accounts and access, onboarding and offboarding, SaaS admin, and help desk requests, so the team can stay on the product. ${SERVICES_LINE}

We work alongside an engineering team rather than replacing anything, and we scale with you as you hire.

${CLOSE}`,
  },
  {
    key: "healthtech",
    channel: "EMAIL",
    name: "HealthTech and MedTech",
    industries: ["healthtech", "medtech"],
    subject: "Business IT for {{companyName}} as you grow",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. For health technology teams, a lot of time goes into the internal side of IT: managed laptops, access reviews, onboarding new hires quickly, and keeping evidence ready for customer security questionnaires. We handle that day-to-day work so your engineers don't have to.

${SERVICES_LINE}

${CLOSE}`,
  },
  {
    key: "fintech",
    channel: "EMAIL",
    name: "FinTech",
    industries: ["fintech"],
    subject: "Internal IT and access management for {{companyName}}",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. Financial technology teams tend to face detailed security reviews from partners and customers. We help with the internal IT behind those answers: device management, identity and access, onboarding and offboarding, and help desk support, working alongside your engineering team.

${SERVICES_LINE}

${CLOSE}`,
  },
  {
    key: "ai-saas",
    channel: "EMAIL",
    name: "AI and SaaS",
    industries: ["ai_saas"],
    subject: "Keeping IT off your engineers' plates at {{companyName}}",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. Fast-moving software teams often end up with engineers handling laptops, accounts and access requests on the side. We take on that internal IT work, from device setup and identity management to onboarding and help desk, and we fit around the tools you already use.

${SERVICES_LINE}

${CLOSE}`,
  },
  {
    key: "biotech",
    channel: "EMAIL",
    name: "Biotech",
    industries: ["biotech"],
    subject: "IT support for {{companyName}}'s office and lab teams",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. Biotech teams usually mix office staff, scientists and outside collaborators, which makes accounts, device management and data access a constant job. We handle that day-to-day IT so your team can stay focused on the science.

${SERVICES_LINE}

${CLOSE}`,
  },
  {
    key: "cyber-datacenter",
    channel: "EMAIL",
    name: "Cybersecurity and data-center technology",
    industries: ["cybersecurity", "datacenter"],
    subject: "Help with the internal IT at {{companyName}}",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. Even deeply technical companies find their own internal IT (laptops, accounts, onboarding, help desk requests) pulls time away from the product. We take that work on and fit around the standards your team already sets.

${SERVICES_LINE}

Would a short call next week be useful?

Thanks,`,
  },
  {
    key: "medical-billing",
    channel: "EMAIL",
    name: "Medical billing and revenue cycle",
    industries: ["medical_billing"],
    subject: "IT support for {{companyName}}'s billing team",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. Billing teams work with sensitive patient and payer information all day, and HIPAA expects access and devices to be managed carefully. We help offices like yours with managed devices, secure sign-in, onboarding and offboarding staff, backup, and a help desk your team can call.

${SERVICES_LINE}

${CLOSE}`,
  },
  {
    key: "private-healthcare",
    channel: "EMAIL",
    name: "Private healthcare practices",
    industries: ["private_healthcare"],
    subject: "IT support for {{companyName}}",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. Private practices need computers, email and front-desk systems that just work, along with the access controls and backups that patient privacy rules expect. We provide that support, plus a help desk your staff can reach when something breaks.

${SERVICES_LINE}

${CLOSE}`,
  },
  {
    key: "veterinary",
    channel: "EMAIL",
    name: "Veterinary practices",
    industries: ["veterinary"],
    subject: "IT support for {{companyName}}",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. Veterinary practices depend on front-desk computers, practice management software and email all day, and downtime means a backed-up lobby. We support practices with managed devices, secure accounts, backups and a help desk your team can call.

${SERVICES_LINE}

${CLOSE}`,
  },
  {
    key: "insurance",
    channel: "EMAIL",
    name: "Insurance agencies",
    industries: ["insurance"],
    subject: "IT support for {{companyName}}",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. Insurance agencies handle a lot of client personal information, and carriers and cyber insurers increasingly ask about things like multifactor sign-in and backups. We help agencies put those pieces in place and keep them running, with a help desk for day-to-day issues.

${SERVICES_LINE}

${CLOSE}`,
  },
  {
    key: "cpa",
    channel: "EMAIL",
    name: "CPA and accounting firms",
    industries: ["cpa"],
    subject: "IT support for {{companyName}} before the next busy season",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. Accounting firms carry a lot of sensitive client financial data, and the IRS expects tax professionals to keep a written information security plan. We help firms with secure sign-in, managed devices, backups and a help desk, so busy season isn't the time things break.

${SERVICES_LINE}

${CLOSE}`,
  },
  {
    key: "law",
    channel: "EMAIL",
    name: "Law firms",
    industries: ["law"],
    subject: "IT support for {{companyName}}",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. Law firms rely on email, document systems and remote access every day, and client confidentiality raises the stakes on who can get to what. We help firms manage devices and access, onboard and offboard staff cleanly, and keep backups and a help desk in place.

${SERVICES_LINE}

${CLOSE}`,
  },
  {
    key: "property-management",
    channel: "EMAIL",
    name: "Property management",
    industries: ["property_management"],
    subject: "IT support for {{companyName}}'s office and field staff",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. Property management teams split time between the office and the field, with staff on laptops and phones handling tenant and owner information. We help keep those devices managed, accounts secure, and new staff set up quickly, with a help desk when something goes wrong.

${SERVICES_LINE}

${CLOSE}`,
  },
  {
    key: "construction-aec",
    channel: "EMAIL",
    name: "Construction, engineering and architecture",
    industries: ["construction", "engineering", "architecture"],
    subject: "IT support for {{companyName}}'s office and job sites",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. Construction and design firms work across offices, job sites and large project files, with people coming on and off projects. We help with device management, secure remote access, file sharing and backup, and fast onboarding and offboarding.

${SERVICES_LINE}

${CLOSE}`,
  },
  {
    key: "financial-services",
    channel: "EMAIL",
    name: "Financial services",
    industries: ["financial_services"],
    subject: "IT support for {{companyName}}",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. Financial firms field detailed questions about how client data is protected, from regulators, custodians and clients themselves. We help with the IT behind those answers: managed devices, secure sign-in, email protection, backups and a responsive help desk.

${SERVICES_LINE}

${CLOSE}`,
  },
  {
    key: "staffing",
    channel: "EMAIL",
    name: "Staffing agencies",
    industries: ["staffing"],
    subject: "Faster onboarding and offboarding at {{companyName}}",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. Staffing teams bring people on and off constantly, and every change means accounts, devices and access to sort out. We make that routine and quick, and we keep candidate data protected along the way, with a help desk for your recruiters.

${SERVICES_LINE}

${CLOSE}`,
  },
  {
    key: "logistics-manufacturing",
    channel: "EMAIL",
    name: "Logistics and manufacturing",
    industries: ["logistics", "manufacturing"],
    subject: "IT support for {{companyName}}",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. Operations-heavy businesses depend on shared computers, office systems and email staying up across shifts and sites. We help with device management, secure accounts, backups and a help desk your team can reach when something stops working.

${SERVICES_LINE}

${CLOSE}`,
  },
  {
    key: "nonprofit",
    channel: "EMAIL",
    name: "Nonprofits",
    industries: ["nonprofit"],
    subject: "IT support for {{companyName}}",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}. Nonprofits often run on a mix of staff, volunteers and donated tools, which makes accounts and access hard to keep track of. We help organize that, set up secure sign-in and backups, and give your team a help desk to call. If you're on Microsoft 365, there may also be nonprofit licensing worth checking.

${SERVICES_LINE}

Would a short call next week be useful?

Thanks,`,
  },
  {
    key: "general",
    channel: "EMAIL",
    name: "General (any industry)",
    industries: ["professional_services", "other"],
    subject: "IT support for {{companyName}}",
    body: `Hi {{firstName}},

{{personalNote}}

I run {{senderCompany}}, a managed IT company. We look after day-to-day IT for growing businesses: devices, accounts and access, onboarding and offboarding, backups and a help desk your team can call.

${SERVICES_LINE}

${CLOSE}`,
  },
  // Follow-ups (sent in the same thread)
  {
    key: "follow-up-1",
    channel: "EMAIL",
    name: "Follow-up 1: quick bump",
    industries: [],
    subject: "Re: {{companyName}}",
    body: `Hi {{firstName}},

Just following up on my note below in case it got buried. If IT support isn't a priority right now, no problem at all. If it would help to talk through how {{companyName}} handles devices, accounts and support today, I'm happy to find a time.

Thanks,`,
  },
  {
    key: "follow-up-2",
    channel: "EMAIL",
    name: "Follow-up 2: offer the security check",
    industries: [],
    subject: "Re: {{companyName}}",
    body: `Hi {{firstName}},

One more thought. If {{companyName}} uses Microsoft 365, I can do a free 15-minute review of the main security settings (sign-in protection, admin accounts, email protection) and send you a short summary. You keep the summary either way.

Would that be useful?

Thanks,`,
  },
  {
    key: "follow-up-3",
    channel: "EMAIL",
    name: "Follow-up 3: last note",
    industries: [],
    subject: "Re: {{companyName}}",
    body: `Hi {{firstName}},

I don't want to fill your inbox, so this is my last note for now. If the timing is better later in the year, just reply and I'll pick it up from there.

Thanks,`,
  },
  // Call scripts
  {
    key: "call-script-general",
    channel: "CALL_SCRIPT",
    name: "Call script: general",
    industries: [],
    subject: "",
    body: `Opening
"Hi, this is {{senderName}} with {{senderCompany}}. Is this a good moment for a quick question?"

If a receptionist answers
"Who usually handles computers and IT questions for the office? Is that the office manager or one of the owners?"
Get their name, and ask for the best time or email to reach them.

Reason for the call
"We're a local managed IT company. We look after devices, Microsoft 365 or Google accounts, backups and help desk support for offices like yours. I'm calling to see who helps you with that today."

Discovery questions
• "Who do people call when a computer or email stops working?"
• "Roughly how many people use a computer at work?"
• "Are you on Microsoft 365, Google Workspace, or something else?"
• "How do you handle setting up a new hire, and turning off access when someone leaves?"

Offer
"If you're on Microsoft 365, I can do a free 15-minute security check and send you a short summary. No obligation."

Close
"Would a 15-minute call later this week work? What's the best email to send an invite to?"

Voicemail (under 20 seconds)
"Hi, this is {{senderName}} with {{senderCompany}}. We provide managed IT support for local businesses. I'll send a short email too. You can reach me at {{senderPhone}}."`,
  },
  {
    key: "call-script-startup",
    channel: "CALL_SCRIPT",
    name: "Call script: tech startups",
    industries: [],
    subject: "",
    body: `Opening
"Hi, this is {{senderName}} with {{senderCompany}}. Do you have a minute?"

Reason for the call
"We handle the business IT side for tech teams: laptops, accounts and access, onboarding and offboarding, and help desk, so engineers can stay on the product. We work alongside your engineering team, not instead of it."

Discovery questions
• "Who handles laptops and access requests today? Is that falling on an engineer or on ops?"
• "How many people are you planning to hire this year?"
• "Do customer security reviews ask about device management or access controls?"

Close
"Would a 15-minute call later this week be useful? What's the best email for an invite?"

Voicemail (under 20 seconds)
"Hi, this is {{senderName}} with {{senderCompany}}. We take internal IT work off engineering teams. I'll send a short email too. You can reach me at {{senderPhone}}."`,
  },
];

export const FOLLOW_UP_KEYS = ["follow-up-1", "follow-up-2", "follow-up-3"];

/** Built-in template key for a lead's industry (first-touch email). */
export function builtInKeyForIndustry(industry: string): string {
  return BUILT_IN_TEMPLATES.find((t) => t.channel === "EMAIL" && t.industries.includes(industry))?.key ?? "general";
}
