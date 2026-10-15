import { INDUSTRIES } from "../constants";

// Ordered: the first rule that matches wins, so specific terms come before broad ones.
const RULES: [RegExp, string][] = [
  [/veterin|animal hospital|\bvet\b|pet clinic/i, "veterinary"],
  [/medical billing|revenue cycle|\brcm\b/i, "medical_billing"],
  [/insurtech|ai insurance|insurance tech|underwriting/i, "insurtech"],
  [/fintech|payments|neobank|alternative assets|lending platform/i, "fintech"],
  [/proptech|real estate tech/i, "proptech"],
  [/legaltech|legal tech/i, "legaltech"],
  [/medtech|medical device|wearable medical|medical technology/i, "medtech"],
  [/biotech|life sciences|computational biology|pharma/i, "biotech"],
  [/healthtech|health tech|digital health|healthcare technology|diabetes tech|health ai/i, "healthtech"],
  [/cyber ?security|infosec/i, "cybersecurity"],
  [/data ?cent(er|re)/i, "datacenter"],
  [/\bcpa\b|accounting firm|accountants?\b|bookkeep|tax prep/i, "cpa"],
  [/\blaw\b|law firm|attorney|legal services/i, "law"],
  [/property management|property manager/i, "property_management"],
  [/insurance/i, "insurance"],
  [/private practice|medical practice|clinic|dental|dentist|physician|healthcare|health care|diagnostics/i, "private_healthcare"],
  [/construction|contractor/i, "construction"],
  [/architect/i, "architecture"],
  [/engineering/i, "engineering"],
  [/financial services|wealth|finance|investment|bank/i, "financial_services"],
  [/staffing|recruit/i, "staffing"],
  [/logistics|freight|shipping|supply chain/i, "logistics"],
  [/manufactur/i, "manufacturing"],
  [/non-?profit|foundation|charity/i, "nonprofit"],
  [/\bai\b|saas|software|cloud|platform|machine learning|edtech|automation/i, "ai_saas"],
  [/tech|startup|gaming|sportstech|media|entertainment|marketplace|app\b/i, "startup_general"],
  [/consult|advisor|agency|professional services|marketing/i, "professional_services"],
];

/**
 * Best-fit industry key for free text. The original text is always kept as the subindustry,
 * so the mapping can be corrected later without losing what the source said.
 */
export function mapIndustry(raw: string | null | undefined): { key: string; matched: boolean } {
  const text = (raw ?? "").trim();
  if (!text) return { key: "other", matched: false };
  const exact = INDUSTRIES.find((i) => i.key === text.toLowerCase() || i.label.toLowerCase() === text.toLowerCase());
  if (exact) return { key: exact.key, matched: true };
  for (const [re, key] of RULES) if (re.test(text)) return { key, matched: true };
  return { key: "other", matched: false };
}
