import { z } from "zod";
import { ASSET_KINDS } from "./naming";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v), "Contains control characters.");

export const primaryUserSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("none") }),
  z.object({ source: z.literal("directory"), tenantId: z.uuid(), objectId: z.uuid() }),
  z.object({ source: z.literal("portal"), userId: z.uuid() }),
]);

/** Hardware details. Dates are YYYY-MM-DD; empty strings clear a value. */
export const hardwareSchema = z.object({
  manufacturer: text(80).optional(),
  model: text(120).optional(),
  serialNumber: text(80).optional(),
  purchaseDate: z.union([z.iso.date(), z.literal("")]).optional(),
  warrantyExpires: z.union([z.iso.date(), z.literal("")]).optional(),
});

export const registerAssetSchema = z.object({
  customerId: z.uuid(),
  kind: z.enum(ASSET_KINDS),
  primaryUser: primaryUserSchema,
  location: text(120).optional().default(""),
  notes: text(1000).optional().default(""),
  hardware: hardwareSchema.optional(),
});

export const updateAssetSchema = z.object({
  version: z.number().int().positive(),
  primaryUser: primaryUserSchema.optional(),
  location: text(120).optional(),
  notes: text(1000).optional(),
  status: z.enum(["active", "retired"]).optional(),
  hardware: hardwareSchema.optional(),
});

export const directorySearchSchema = z.object({
  customerId: z.uuid(),
  q: z.string().trim().min(2).max(64),
});
