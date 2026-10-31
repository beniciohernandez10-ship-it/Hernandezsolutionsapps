// Shared, client-safe constants. No server imports here.

export const APP_NAME = "Hernandez Solutions | Lead Command Center";
export const APP_SHORT_NAME = "Lead Command Center";
export const POSITIONING = "Microsoft Cloud • Cybersecurity • Managed IT Services";
export const DEFAULT_PRICE_PER_USER = 65;
export const DEFAULT_DAILY_CALL_GOAL = 10;

export const PIPELINE_STAGES = [
  { key: "NEW_LEAD", label: "New Lead" },
  { key: "RESEARCHING", label: "Researching" },
  { key: "READY_TO_CONTACT", label: "Ready to Contact" },
  { key: "ATTEMPTED_CONTACT", label: "Attempted Contact" },
  { key: "CONTACTED", label: "Contacted" },
  { key: "FOLLOW_UP_REQUIRED", label: "Follow-Up Required" },
  { key: "INTERESTED", label: "Interested" },
  { key: "DISCOVERY_SCHEDULED", label: "Discovery Scheduled" },
  { key: "DISCOVERY_COMPLETED", label: "Discovery Completed" },
  { key: "ASSESSMENT", label: "Assessment" },
  { key: "PROPOSAL_DRAFTING", label: "Proposal Drafting" },
  { key: "PROPOSAL_SENT", label: "Proposal Sent" },
  { key: "NEGOTIATION", label: "Negotiation" },
  { key: "CONTRACT_SENT", label: "Contract Sent" },
  { key: "CLOSED_WON", label: "Closed Won" },
  { key: "CLOSED_LOST", label: "Closed Lost" },
  { key: "NOT_INTERESTED", label: "Not Interested" },
  { key: "FUTURE_OPPORTUNITY", label: "Future Opportunity" },
] as const;

export type StageKey = (typeof PIPELINE_STAGES)[number]["key"];
export const STAGE_KEYS = PIPELINE_STAGES.map((s) => s.key) as StageKey[];
export const STAGE_LABEL: Record<string, string> = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.key, s.label]));

/** Stages where the deal is finished one way or the other; excluded from open pipeline value. */
export const CLOSED_STAGES: StageKey[] = ["CLOSED_WON", "CLOSED_LOST", "NOT_INTERESTED"];
export const LOST_STAGES: StageKey[] = ["CLOSED_LOST", "NOT_INTERESTED"];
/** Stages that mean nobody has reached out yet. */
export const UNTOUCHED_STAGES: StageKey[] = ["NEW_LEAD", "RESEARCHING", "READY_TO_CONTACT"];

/** Default close probability by stage, used only when a lead has no probability of its own. */
export const STAGE_PROBABILITY: Record<StageKey, number> = {
  NEW_LEAD: 2,
  RESEARCHING: 2,
  READY_TO_CONTACT: 3,
  ATTEMPTED_CONTACT: 3,
  CONTACTED: 5,
  FOLLOW_UP_REQUIRED: 5,
  INTERESTED: 15,
  DISCOVERY_SCHEDULED: 20,
  DISCOVERY_COMPLETED: 30,
  ASSESSMENT: 40,
  PROPOSAL_DRAFTING: 45,
  PROPOSAL_SENT: 50,
  NEGOTIATION: 65,
  CONTRACT_SENT: 80,
  CLOSED_WON: 100,
  CLOSED_LOST: 0,
  NOT_INTERESTED: 0,
  FUTURE_OPPORTUNITY: 2,
};

export const INDUSTRIES = [
  { key: "startup_general", label: "Startups (general)" },
  { key: "healthtech", label: "HealthTech" },
  { key: "medtech", label: "MedTech" },
  { key: "fintech", label: "FinTech" },
  { key: "insurtech", label: "InsurTech" },
  { key: "proptech", label: "PropTech" },
  { key: "legaltech", label: "LegalTech" },
  { key: "ai_saas", label: "AI / SaaS" },
  { key: "biotech", label: "Biotech" },
  { key: "cybersecurity", label: "Cybersecurity" },
  { key: "datacenter", label: "Data-center technology" },
  { key: "medical_billing", label: "Medical billing / RCM" },
  { key: "private_healthcare", label: "Private healthcare" },
  { key: "veterinary", label: "Veterinary practices" },
  { key: "insurance", label: "Insurance" },
  { key: "cpa", label: "CPA / accounting" },
  { key: "law", label: "Law firms" },
  { key: "property_management", label: "Property management" },
  { key: "construction", label: "Construction" },
  { key: "engineering", label: "Engineering" },
  { key: "architecture", label: "Architecture" },
  { key: "financial_services", label: "Financial services" },
  { key: "staffing", label: "Staffing" },
  { key: "logistics", label: "Logistics" },
  { key: "manufacturing", label: "Manufacturing" },
  { key: "nonprofit", label: "Nonprofits" },
  { key: "professional_services", label: "Other professional services" },
  { key: "other", label: "Other" },
] as const;

export type IndustryKey = (typeof INDUSTRIES)[number]["key"];
export const INDUSTRY_LABEL: Record<string, string> = Object.fromEntries(INDUSTRIES.map((i) => [i.key, i.label]));
export const VETERINARY_INDUSTRY = "veterinary";
/** Industries that are technology companies; templates for these speak to engineering teams. */
export const TECH_INDUSTRIES = new Set([
  "startup_general", "healthtech", "medtech", "fintech", "insurtech", "proptech", "legaltech",
  "ai_saas", "biotech", "cybersecurity", "datacenter",
]);

export const REGIONS = [
  { key: "san_francisco", label: "San Francisco" },
  { key: "east_bay", label: "East Bay" },
  { key: "peninsula_sv", label: "Peninsula / Silicon Valley" },
  { key: "los_angeles", label: "Los Angeles" },
  { key: "beverly_hills", label: "Beverly Hills" },
  { key: "west_hollywood", label: "West Hollywood" },
  { key: "santa_monica", label: "Santa Monica" },
  { key: "culver_city", label: "Culver City" },
  { key: "orange_county", label: "Orange County" },
  { key: "inland_empire", label: "Inland Empire" },
  { key: "sacramento", label: "Sacramento" },
  { key: "san_diego", label: "San Diego" },
  { key: "other_california", label: "Other California" },
  { key: "out_of_state", label: "Out of State" },
] as const;

export type RegionKey = (typeof REGIONS)[number]["key"];
export const REGION_LABEL: Record<string, string> = Object.fromEntries(REGIONS.map((r) => [r.key, r.label]));

export const PRIORITIES = [
  { key: "HIGH", label: "High" },
  { key: "MEDIUM", label: "Medium" },
  { key: "LOW", label: "Low" },
] as const;
export const PRIORITY_LABEL: Record<string, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

export const VERIFICATION = [
  { key: "VERIFIED", label: "Verified" },
  { key: "UNVERIFIED", label: "Unverified" },
  { key: "UNKNOWN", label: "Unknown" },
  { key: "INVALID", label: "Invalid" },
] as const;
export const VERIFICATION_LABEL: Record<string, string> = Object.fromEntries(VERIFICATION.map((v) => [v.key, v.label]));

export const CONTACT_METHODS = [
  { key: "EMAIL", label: "Email" },
  { key: "PHONE", label: "Phone" },
  { key: "CONTACT_FORM", label: "Contact form" },
  { key: "LINKEDIN", label: "LinkedIn" },
  { key: "IN_PERSON", label: "In person" },
  { key: "UNKNOWN", label: "Unknown" },
] as const;
export const CONTACT_METHOD_LABEL: Record<string, string> = Object.fromEntries(CONTACT_METHODS.map((c) => [c.key, c.label]));

export const BUSINESS_STAGES = [
  { key: "STARTUP", label: "Startup" },
  { key: "ESTABLISHED", label: "Established business" },
  { key: "UNKNOWN", label: "Unknown" },
] as const;
export const BUSINESS_STAGE_LABEL: Record<string, string> = Object.fromEntries(BUSINESS_STAGES.map((b) => [b.key, b.label]));

export const CALL_OUTCOMES = [
  { key: "NO_ANSWER", label: "No answer", reached: false },
  { key: "LEFT_VOICEMAIL", label: "Left voicemail", reached: false },
  { key: "RECEPTIONIST", label: "Receptionist answered", reached: true },
  { key: "DECISION_MAKER_IDENTIFIED", label: "Decision-maker identified", reached: true },
  { key: "SPOKE_WITH_DECISION_MAKER", label: "Spoke with decision-maker", reached: true },
  { key: "REQUESTED_EMAIL", label: "Requested email", reached: true },
  { key: "INTERESTED", label: "Interested", reached: true },
  { key: "MEETING_SCHEDULED", label: "Meeting scheduled", reached: true },
  { key: "NOT_INTERESTED", label: "Not interested", reached: true },
  { key: "WRONG_NUMBER", label: "Wrong number", reached: false },
  { key: "CALL_BACK_LATER", label: "Call back later", reached: true },
] as const;
export type CallOutcomeKey = (typeof CALL_OUTCOMES)[number]["key"];
export const CALL_OUTCOME_LABEL: Record<string, string> = Object.fromEntries(CALL_OUTCOMES.map((c) => [c.key, c.label]));

export const TASK_TYPES = [
  { key: "CALLBACK", label: "Callback" },
  { key: "EMAIL", label: "Follow-up email" },
  { key: "MEETING", label: "Discovery meeting" },
  { key: "PROPOSAL", label: "Proposal" },
  { key: "CONTRACT", label: "Contract reminder" },
  { key: "REENGAGE", label: "Re-engage" },
  { key: "OTHER", label: "Other" },
] as const;
export const TASK_TYPE_LABEL: Record<string, string> = Object.fromEntries(TASK_TYPES.map((t) => [t.key, t.label]));

export const ROLES = [
  { key: "OWNER", label: "Owner", description: "Everything, including users, backups and restore." },
  { key: "ADMIN", label: "Admin", description: "Everything except restore and owner accounts." },
  { key: "SALES", label: "Sales", description: "Work leads, calls, emails and follow-ups." },
  { key: "VIEWER", label: "Viewer", description: "Read-only access." },
] as const;
export const ROLE_LABEL: Record<string, string> = Object.fromEntries(ROLES.map((r) => [r.key, r.label]));

export const EMAIL_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Waiting for approval",
  APPROVED: "Approved",
  SENDING: "Sending",
  SENT: "Sent",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const ENROLLMENT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  REPLIED: "Replied",
  COMPLETED: "Completed",
  STOPPED: "Stopped",
};

export const ACTIVITY_LABEL: Record<string, string> = {
  CALL: "Call",
  EMAIL_SENT: "Email sent",
  EMAIL_APPROVED: "Email approved",
  NOTE: "Note",
  STAGE_CHANGE: "Stage change",
  MEETING: "Meeting",
  FOLLOW_UP_CREATED: "Follow-up scheduled",
  FOLLOW_UP_DONE: "Follow-up completed",
  IMPORTED: "Imported",
  UPDATED: "Updated",
  CONVERTED: "Converted to client",
  RESEARCH: "Research",
  REPLY_RECEIVED: "Reply received",
  ATTACHMENT: "File",
  WEBSITE_INQUIRY: "Website inquiry",
  UNSUBSCRIBED: "Opted out",
  BOUNCED: "Email bounced",
};

export const DEFAULT_ONBOARDING_CHECKLIST = [
  "Signed agreement and service scope on file",
  "Primary and billing contacts confirmed",
  "Delegated admin relationship (GDAP) requested in Microsoft 365",
  "Microsoft 365 tenant and licensing reviewed",
  "MFA and Conditional Access baseline agreed",
  "Device inventory collected",
  "Intune enrollment plan agreed",
  "Backup and recovery plan confirmed",
  "Help desk and support portal access explained to staff",
  "Onboarding and offboarding process agreed",
  "Kickoff meeting held",
];
