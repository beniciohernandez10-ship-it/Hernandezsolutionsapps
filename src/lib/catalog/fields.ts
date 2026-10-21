import { z } from "zod";
import { AppError } from "../errors";

/**
 * Catalog form definitions and answer validation. Shared by the server (which
 * re-validates every submission) and the browser form.
 */
export const FIELD_TYPES = ["text", "textarea", "email", "date", "number", "select", "checkbox"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const fieldSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, { error: "Field keys use lowercase letters, numbers and underscores." }),
    label: z.string().trim().min(1).max(120),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
    help: z.string().trim().max(200).optional(),
  })
  .refine((f) => f.type !== "select" || (f.options?.length ?? 0) >= 2, { error: "A choice field needs at least two options.", path: ["options"] });
export type CatalogField = z.infer<typeof fieldSchema>;

export const fieldsSchema = z
  .array(fieldSchema)
  .max(30)
  .refine((fs) => new Set(fs.map((f) => f.key)).size === fs.length, { error: "Each field needs a different key." });

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export interface Answer {
  key: string;
  label: string;
  value: string;
}

/**
 * Checks answers against the form. Unknown keys are ignored, values are
 * normalised to text, and errors are reported per field.
 */
export function validateAnswers(fields: CatalogField[], raw: unknown): Answer[] {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const errors: { path: string; message: string }[] = [];
  const out: Answer[] = [];
  for (const f of fields) {
    const v = input[f.key];
    let value = "";
    if (f.type === "checkbox") value = v === true || v === "true" || v === "on" ? "Yes" : "No";
    else if (v !== undefined && v !== null) value = String(v).replace(/\r\n/g, "\n").trim();
    const fail = (message: string) => errors.push({ path: `answers.${f.key}`, message });
    if (f.type !== "checkbox" && !value) {
      if (f.required) fail(`${f.label} is required.`);
      out.push({ key: f.key, label: f.label, value: "" });
      continue;
    }
    if (CONTROL.test(value)) fail(`${f.label} contains invalid characters.`);
    const max = f.type === "textarea" ? 5000 : 500;
    if (value.length > max) fail(`${f.label} must be at most ${max} characters.`);
    if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail(`${f.label} must be an email address.`);
    if (f.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) fail(`${f.label} must be a date.`);
    if (f.type === "number" && !/^-?\d+(\.\d+)?$/.test(value)) fail(`${f.label} must be a number.`);
    if (f.type === "select" && !f.options?.includes(value)) fail(`Choose one of the options for ${f.label}.`);
    out.push({ key: f.key, label: f.label, value });
  }
  if (errors.length) throw new AppError(422, "validation_failed", "Please check the highlighted fields.", { fields: errors });
  return out;
}

/** Plain-text description of the answers, stored as the ticket description. */
export function describeAnswers(itemName: string, answers: Answer[], notes?: string) {
  const lines = answers.filter((a) => a.value).map((a) => (a.value.includes("\n") ? `${a.label}:\n${a.value}` : `${a.label}: ${a.value}`));
  return [`${itemName}`, "", ...lines, ...(notes ? ["", notes] : [])].join("\n").slice(0, 20000);
}
