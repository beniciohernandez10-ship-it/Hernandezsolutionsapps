export type Verification = "VERIFIED" | "UNVERIFIED" | "UNKNOWN" | "INVALID";
export type Method = "EMAIL" | "PHONE" | "CONTACT_FORM" | "LINKEDIN" | "IN_PERSON" | "UNKNOWN";

export interface ImportContact {
  name: string;
  title: string | null;
  email: string | null;
  emailStatus: Verification;
  phone: string | null;
  phoneStatus: Verification;
  linkedinUrl: string | null;
  isDecisionMaker: boolean;
}

/** One incoming prospect after mapping and cleanup. Missing values stay null; nothing is guessed. */
export interface ImportRow {
  rowNumber: number;
  externalId: string | null;
  name: string;
  industry: string;
  subindustry: string | null;
  businessStage: "STARTUP" | "ESTABLISHED" | "UNKNOWN";
  website: string | null;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  headquarters: string | null;
  region: string | null;
  employeeCount: number | null;
  employeeCountSource: string | null;
  description: string | null;
  ownershipType: string | null;
  fundingStage: string | null;
  growthIndicators: string | null;
  mainEmail: string | null;
  mainEmailStatus: Verification;
  mainPhone: string | null;
  mainPhoneStatus: Verification;
  contactFormUrl: string | null;
  preferredContactMethod: Method;
  contacts: ImportContact[];
  priority: "HIGH" | "MEDIUM" | "LOW";
  stage: string;
  lastContactedAt: string | null;
  managedUsers: number | null;
  tags: string[];
  notes: string | null;
  source: string | null;
  sourceUrl: string | null;
  personalNote: string | null;
  /** Problems found while reading the row (bad email, unparseable phone…). */
  warnings: string[];
}

export interface RowOutcome {
  rowNumber: number;
  name: string;
  externalId: string | null;
  result: "created" | "merged" | "flagged" | "skipped";
  companyId?: string;
  matchedName?: string;
  reasons?: string[];
  warnings?: string[];
}

export interface ImportReport {
  fileName: string;
  dryRun: boolean;
  totalRecords: number;
  created: number;
  merged: number;
  flagged: number;
  skipped: number;
  uniqueCompanies: number;
  contactsCreated: number;
  verifiedEmailContacts: number;
  verifiedPhoneContacts: number;
  missing: {
    email: number;
    phone: number;
    location: number;
    industry: number;
    contactName: number;
    website: number;
  };
  /** Created rows confirmed by reading them back from the database after the import. */
  confirmedInDatabase: number;
  rows: RowOutcome[];
}
