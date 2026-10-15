import { z } from "zod";

/**
 * Evidence-based 100-point lead score.
 *
 * Every factor reports its basis:
 *  - "data":     computed from fields on the record (employee count, region, verified contacts)
 *  - "manual":   set by a person, with the evidence they recorded
 *  - "inferred": an estimate from industry or size, never a claim about the company
 *  - "unknown":  no evidence yet, so the factor scores 0
 * A score is labeled an estimate whenever any factor is inferred or unknown.
 */

export const SCORING_FACTORS = [
  { key: "microsoft_fit", label: "Microsoft IT service compatibility", defaultMax: 15 },
  { key: "employee_count", label: "Employee count", defaultMax: 15 },
  { key: "cloud_endpoint", label: "Cloud and endpoint-management needs", defaultMax: 10 },
  { key: "security", label: "Security requirements", defaultMax: 15 },
  { key: "growth", label: "Growth potential", defaultMax: 10 },
  { key: "outsourcing", label: "Likelihood of outsourcing IT", defaultMax: 10 },
  { key: "decision_maker", label: "Decision-maker accessibility", defaultMax: 10 },
  { key: "geography", label: "Geographic relevance", defaultMax: 5 },
  { key: "contact_quality", label: "Contact information quality", defaultMax: 10 },
] as const;

export type FactorKey = (typeof SCORING_FACTORS)[number]["key"];
export type Basis = "data" | "manual" | "inferred" | "unknown";

export const scoringConfigSchema = z.object({
  weights: z.record(z.string(), z.coerce.number().int().min(0).max(100)).default({}),
  coreRegions: z.array(z.string()).default([
    "san_francisco", "east_bay", "peninsula_sv", "los_angeles", "beverly_hills", "west_hollywood",
    "santa_monica", "culver_city", "orange_county",
  ]),
  regulatedIndustries: z.array(z.string()).default([
    "medical_billing", "private_healthcare", "healthtech", "medtech", "biotech", "cpa", "financial_services",
    "fintech", "insurance", "insurtech", "law", "veterinary",
  ]),
});
export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

export const DEFAULT_SCORING: ScoringConfig = scoringConfigSchema.parse({
  weights: Object.fromEntries(SCORING_FACTORS.map((f) => [f.key, f.defaultMax])),
});

export function weightsOf(config: ScoringConfig): Record<FactorKey, number> {
  const out = {} as Record<FactorKey, number>;
  for (const f of SCORING_FACTORS) out[f.key] = config.weights[f.key] ?? f.defaultMax;
  return out;
}

export interface ManualFactor {
  /** 0–1 share of the factor's maximum. */
  share: number;
  evidence: string;
}

export interface ScoreInput {
  industry: string;
  businessStage?: string | null;
  employeeCount?: number | null;
  region?: string | null;
  additionalLocations?: string[] | null;
  fundingStage?: string | null;
  growthIndicators?: string | null;
  mainEmail?: string | null;
  mainEmailStatus?: string | null;
  mainPhone?: string | null;
  mainPhoneStatus?: string | null;
  contacts: {
    name?: string | null;
    title?: string | null;
    email?: string | null;
    emailStatus?: string | null;
    phone?: string | null;
    phoneStatus?: string | null;
    linkedinUrl?: string | null;
    isDecisionMaker?: boolean | null;
  }[];
  manual?: Partial<Record<FactorKey, ManualFactor>>;
}

export interface FactorResult {
  key: FactorKey;
  label: string;
  max: number;
  points: number;
  basis: Basis;
  evidence: string;
}

export interface ScoreResult {
  total: number;
  isEstimate: boolean;
  factors: FactorResult[];
}

const DECISION_TITLES = /\b(owner|founder|co-?founder|ceo|coo|cto|cfo|president|principal|partner|managing|director|practice manager|office manager|operations|head of|vp|vice president|administrator)\b/i;
const TECH = new Set(["startup_general", "healthtech", "medtech", "fintech", "insurtech", "proptech", "legaltech", "ai_saas", "biotech", "cybersecurity", "datacenter"]);

function share(basis: Basis, value: number, evidence: string) {
  return { basis, value: Math.max(0, Math.min(1, value)), evidence };
}

function verifiedWeight(status?: string | null): number {
  if (status === "VERIFIED") return 1;
  if (status === "INVALID") return 0;
  return 0.5;
}

export function computeScore(input: ScoreInput, config: ScoringConfig = DEFAULT_SCORING): ScoreResult {
  const weights = weightsOf(config);
  const emp = input.employeeCount ?? null;
  const auto: Record<FactorKey, { basis: Basis; value: number; evidence: string }> = {
    microsoft_fit: share("unknown", 0, "Not verified. Set it after checking, for example with an MX record lookup."),
    employee_count:
      emp === null
        ? share("unknown", 0, "Employee count not recorded.")
        : share("data", emp < 5 ? 0.25 : emp < 25 ? 0.7 : emp <= 100 ? 1 : emp <= 250 ? 0.85 : 0.5, `${emp} employees on record.`),
    cloud_endpoint: (() => {
      const locations = (input.additionalLocations ?? []).filter(Boolean).length;
      if (locations > 0) return share("data", 0.8, `${locations + 1} locations on record.`);
      if (TECH.has(input.industry)) return share("inferred", 0.7, "Estimate: technology companies usually run cloud tools and laptops.");
      if (emp !== null && emp >= 10) return share("inferred", 0.6, "Estimate: based on team size.");
      return share("unknown", 0, "No evidence recorded.");
    })(),
    security: config.regulatedIndustries.includes(input.industry)
      ? share("inferred", 1, "Estimate: this industry typically handles regulated or sensitive data.")
      : share("inferred", 0.5, "Estimate: general business data."),
    growth:
      input.fundingStage || input.growthIndicators
        ? share("data", 0.8, [input.fundingStage && `Funding: ${input.fundingStage}`, input.growthIndicators].filter(Boolean).join(". "))
        : share("unknown", 0, "No growth indicators recorded."),
    outsourcing:
      emp === null
        ? share("unknown", 0, "Employee count not recorded.")
        : share("inferred", emp <= 150 ? 0.6 : 0.3, "Estimate: smaller organizations more often outsource IT. Not a claim about their current setup."),
    decision_maker: (() => {
      const dm = input.contacts.find((c) => c.isDecisionMaker);
      if (dm) return share("data", 1, `${dm.name ?? "Contact"} is marked as a decision-maker.`);
      const titled = input.contacts.find((c) => c.title && DECISION_TITLES.test(c.title));
      if (titled) return share("inferred", 0.7, `Estimate: ${titled.name ?? "contact"} has the title "${titled.title}".`);
      if (input.contacts.some((c) => c.name)) return share("data", 0.3, "A named contact is on record.");
      return share("unknown", 0, "No named contact.");
    })(),
    geography: !input.region
      ? share("unknown", 0, "Region not set.")
      : config.coreRegions.includes(input.region)
        ? share("data", 1, "In a core service area.")
        : input.region === "out_of_state"
          ? share("data", 0.3, "Out of state.")
          : share("data", 0.5, "In California, outside the core service areas."),
    contact_quality: (() => {
      let v = 0;
      const notes: string[] = [];
      const emails = [{ email: input.mainEmail, status: input.mainEmailStatus }, ...input.contacts.map((c) => ({ email: c.email, status: c.emailStatus }))].filter((e) => e.email);
      const phones = [{ phone: input.mainPhone, status: input.mainPhoneStatus }, ...input.contacts.map((c) => ({ phone: c.phone, status: c.phoneStatus }))].filter((p) => p.phone);
      const bestEmail = Math.max(0, ...emails.map((e) => verifiedWeight(e.status)));
      const bestPhone = Math.max(0, ...phones.map((p) => verifiedWeight(p.status)));
      v += 0.4 * bestEmail;
      v += 0.3 * bestPhone;
      if (bestEmail) notes.push(bestEmail === 1 ? "verified email" : "unverified email");
      if (bestPhone) notes.push(bestPhone === 1 ? "verified phone" : "unverified phone");
      if (input.contacts.some((c) => c.name)) { v += 0.2; notes.push("named contact"); }
      if (input.contacts.some((c) => c.linkedinUrl)) { v += 0.1; notes.push("LinkedIn"); }
      return v === 0 ? share("unknown", 0, "No contact details.") : share("data", v, `Has ${notes.join(", ")}.`);
    })(),
  };

  const factors: FactorResult[] = SCORING_FACTORS.map((f) => {
    const max = weights[f.key];
    const manual = input.manual?.[f.key];
    const r = manual ? { basis: "manual" as Basis, value: Math.max(0, Math.min(1, manual.share)), evidence: manual.evidence } : auto[f.key];
    return { key: f.key, label: f.label, max, points: Math.round(max * r.value), basis: r.basis, evidence: r.evidence };
  });

  const totalMax = factors.reduce((s, f) => s + f.max, 0) || 1;
  const raw = factors.reduce((s, f) => s + f.points, 0);
  const total = Math.round((raw / totalMax) * 100);
  return { total, isEstimate: factors.some((f) => f.basis === "inferred" || f.basis === "unknown"), factors };
}
