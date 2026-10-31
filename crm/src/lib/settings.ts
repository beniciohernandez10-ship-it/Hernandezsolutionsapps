import { z } from "zod";
import { db } from "./db";
import { DEFAULT_PRICE_PER_USER } from "./constants";
import { DEFAULT_SCORING, scoringConfigSchema } from "./scoring";

export const outreachSettingsSchema = z.object({
  senderName: z.string().max(120).default("Benny"),
  companyName: z.string().max(120).default("Hernandez Solutions LLC"),
  website: z.string().max(200).default("thehernandezsolutions.com"),
  // Used in call-script voicemail lines.
  senderPhone: z.string().max(40).default(""),
  signature: z.string().max(2000).default("Hernandez Solutions LLC\nMicrosoft Cloud • Cybersecurity • Managed IT Services\nthehernandezsolutions.com"),
  // CAN-SPAM requires a valid postal address in commercial email; sending is blocked until it is set.
  mailingAddress: z.string().max(300).default(""),
  optOutLine: z.string().max(300).default("If you'd rather not hear from me, reply \"no thanks\" and I won't email again."),
  dailySendCap: z.coerce.number().int().min(1).max(500).default(30),
  // Only send between these hours (business time zone) when approving in bulk.
  defaultFollowUpDays: z.coerce.number().int().min(1).max(60).default(3),
});
export type OutreachSettings = z.infer<typeof outreachSettingsSchema>;

export const salesSettingsSchema = z.object({
  pricePerUser: z.coerce.number().min(0).max(10000).default(DEFAULT_PRICE_PER_USER),
  dailyCallGoal: z.coerce.number().int().min(1).max(200).default(10),
  // Days to wait before calling again after no answer / voicemail.
  retryAfterNoAnswerDays: z.coerce.number().int().min(1).max(30).default(2),
  maxCallAttempts: z.coerce.number().int().min(1).max(20).default(6),
});
export type SalesSettings = z.infer<typeof salesSettingsSchema>;

export const securitySettingsSchema = z.object({
  requireMfa: z.boolean().default(true),
  sessionHours: z.coerce.number().int().min(1).max(24 * 30).default(12),
});
export type SecuritySettings = z.infer<typeof securitySettingsSchema>;

// State of background work, not user settings. Separate keys, so the two can't overwrite each other.
export const inboxSyncSchema = z.object({
  lastRunAt: z.string().nullable().default(null),
  lastSuccessAt: z.string().nullable().default(null),
  lastError: z.string().nullable().default(null),
});
export const digestStateSchema = z.object({
  lastDay: z.string().nullable().default(null),
  lastAt: z.string().nullable().default(null),
});

const SCHEMAS = {
  outreach: outreachSettingsSchema,
  inboxSync: inboxSyncSchema,
  digest: digestStateSchema,
  sales: salesSettingsSchema,
  security: securitySettingsSchema,
  scoring: scoringConfigSchema,
} as const;

type Schemas = typeof SCHEMAS;
export type SettingKey = keyof Schemas;
export type SettingValue<K extends SettingKey> = z.infer<Schemas[K]>;

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await db.setting.findUnique({ where: { key } });
  const schema = SCHEMAS[key];
  const fallback = key === "scoring" ? DEFAULT_SCORING : {};
  const parsed = schema.safeParse(row?.value ?? fallback);
  return (parsed.success ? parsed.data : schema.parse(fallback)) as SettingValue<K>;
}

export async function setSetting<K extends SettingKey>(key: K, value: unknown): Promise<SettingValue<K>> {
  const parsed = SCHEMAS[key].parse(value) as SettingValue<K>;
  await db.setting.upsert({ where: { key }, create: { key, value: parsed as object }, update: { value: parsed as object } });
  return parsed;
}
