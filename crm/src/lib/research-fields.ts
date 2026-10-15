// Client-safe list of fields the research assistant (and people) can record.

export const RESEARCH_FIELDS = [
  "website", "description", "industry", "subindustry", "employeeCount", "streetAddress", "city", "state", "zip",
  "mainPhone", "mainEmail", "contactFormUrl", "fundingStage", "growthIndicators", "ownershipType", "contact", "technology", "openingLine",
] as const;
export type ResearchField = (typeof RESEARCH_FIELDS)[number];

export const RESEARCH_FIELD_LABEL: Record<ResearchField, string> = {
  website: "Website",
  description: "Company description",
  industry: "Industry",
  subindustry: "Subindustry",
  employeeCount: "Employee count",
  streetAddress: "Street address",
  city: "City",
  state: "State",
  zip: "ZIP code",
  mainPhone: "Main business phone",
  mainEmail: "Main business email",
  contactFormUrl: "Contact form",
  fundingStage: "Funding stage",
  growthIndicators: "Growth indicator",
  ownershipType: "Ownership",
  contact: "Decision-maker (name — title)",
  technology: "Technology clue",
  openingLine: "Suggested opening line",
};

