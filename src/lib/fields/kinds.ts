import type { Category } from "../tickets/schemas";

/** Custom field types and shapes, shared by the server and the browser. */

export const FIELD_KINDS = ["text", "long_text", "number", "date", "select", "checkbox"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];
export const FIELD_KIND_LABEL: Record<FieldKind, string> = {
  text: "Short text",
  long_text: "Paragraph",
  number: "Number",
  date: "Date",
  select: "Choice list",
  checkbox: "Yes / no",
};

export interface FieldDef {
  id: string;
  customerId: string | null;
  category: Category | null;
  label: string;
  help: string | null;
  kind: FieldKind;
  options: string[];
  required: boolean;
  staffOnly: boolean;
  position: number;
  active: boolean;
}

export interface FieldValue extends FieldDef {
  value: string | null;
  /** False when the field no longer applies (category changed, field turned off) but has a saved answer. */
  applies: boolean;
}

export const appliesTo = (f: FieldDef, customerId: string, category: string) =>
  f.active && (f.customerId === null || f.customerId === customerId) && (f.category === null || f.category === category);
