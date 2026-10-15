import { z } from "zod";
import { INDUSTRIES, REGIONS, STAGE_KEYS } from "../constants";
import { normalizeEmail, normalizeState, normalizeWebsite } from "../normalize";

const opt = (max = 300) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const optInt = z.preprocess((v) => (v === undefined || v === "" ? null : Number(v)), z.number().int().min(0).max(10_000_000).nullable());
const optMoney = z.preprocess((v) => (v === undefined || v === "" ? null : Number(String(v).replace(/[$,]/g, ""))), z.number().min(0).max(100_000_000).nullable());
const optDate = z.preprocess((v) => (v === undefined || v === "" ? null : new Date(String(v))), z.date().nullable());
const verification = z.enum(["VERIFIED", "UNVERIFIED", "UNKNOWN", "INVALID"]).default("UNKNOWN");
const method = z.enum(["EMAIL", "PHONE", "CONTACT_FORM", "LINKEDIN", "IN_PERSON", "UNKNOWN"]).default("UNKNOWN");

const email = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const e = normalizeEmail(v);
    if (!e) {
      ctx.addIssue({ code: "custom", message: "That doesn't look like an email address." });
      return z.NEVER;
    }
    return e;
  });

export const companySchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(200),
  industry: z.enum(INDUSTRIES.map((i) => i.key) as [string, ...string[]]).default("other"),
  subindustry: opt(120),
  businessStage: z.enum(["STARTUP", "ESTABLISHED", "UNKNOWN"]).default("UNKNOWN"),
  website: z.string().trim().max(300).optional().transform((v) => (v ? normalizeWebsite(v) ?? v : null)),
  streetAddress: opt(200),
  city: opt(100),
  state: z.string().trim().max(50).optional().transform((v) => (v ? normalizeState(v) : null)),
  zip: opt(20),
  region: z.preprocess((v) => (v === "" ? undefined : v), z.enum(REGIONS.map((r) => r.key) as [string, ...string[]]).optional()).transform((v) => v ?? null),
  headquarters: opt(200),
  additionalLocations: z.string().max(2000).optional().transform((v) => (v ? v.split(/\n|;/).map((s) => s.trim()).filter(Boolean) : [])),
  employeeCount: optInt,
  employeeCountSource: opt(300),
  description: opt(4000),
  ownershipType: opt(100),
  fundingStage: opt(100),
  growthIndicators: opt(1000),
  mainEmail: email,
  mainEmailStatus: verification,
  mainPhone: opt(40),
  mainPhoneStatus: verification,
  contactFormUrl: opt(300),
  preferredContactMethod: method,
  source: opt(300),
  sourceUrl: opt(500),
  personalNote: opt(500),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  stage: z.enum(STAGE_KEYS as [string, ...string[]]).default("NEW_LEAD"),
  ownerId: opt(50),
  notes: opt(20000),
  tags: z.string().max(1000).optional().transform((v) => (v ? Array.from(new Set(v.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))) : [])),
  managedUsers: optInt,
  pricePerUser: optMoney,
  monthlyValueOverride: optMoney,
  implementationFee: optMoney,
  closeProbability: z.preprocess((v) => (v === undefined || v === "" ? null : Number(v)), z.number().int().min(0).max(100).nullable()),
  expectedCloseDate: optDate,
  doNotContact: z.preprocess((v) => v === "on" || v === "true", z.boolean()).default(false),
});
export type CompanyInput = z.infer<typeof companySchema>;

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150),
  title: opt(150),
  email,
  emailStatus: verification,
  phone: opt(40),
  phoneStatus: verification,
  linkedinUrl: opt(300),
  preferredContactMethod: method,
  source: opt(300),
  isPrimary: z.preprocess((v) => v === "on" || v === "true", z.boolean()).default(false),
  isDecisionMaker: z.preprocess((v) => v === "on" || v === "true", z.boolean()).default(false),
  doNotContact: z.preprocess((v) => v === "on" || v === "true", z.boolean()).default(false),
  notes: opt(4000),
});
export type ContactInput = z.infer<typeof contactSchema>;
