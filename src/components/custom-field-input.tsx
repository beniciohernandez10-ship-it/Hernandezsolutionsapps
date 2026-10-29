"use client";
import type { FieldDef } from "@/lib/fields/kinds";

/** One custom field as a form control. Values are strings ("yes" for a ticked yes/no). */
export function CustomFieldInput({
  field,
  value,
  onChange,
  idPrefix,
  error,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
  idPrefix: string;
  error?: string;
}) {
  const id = `${idPrefix}-${field.id}`;
  const hintId = field.help ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  const common = { id, "aria-invalid": Boolean(error), "aria-describedby": describedBy, required: field.required };
  const label = (
    <>
      {field.label}
      {!field.required && field.kind !== "checkbox" && <span className="subtle"> (optional)</span>}
      {field.staffOnly && <span className="subtle"> · technicians only</span>}
    </>
  );
  if (field.kind === "checkbox") {
    return (
      <div className="field">
        <label className="check" htmlFor={id}>
          <input type="checkbox" {...common} required={false} checked={value === "yes"} onChange={(e) => onChange(e.target.checked ? "yes" : "")} /> {label}
        </label>
        {field.help && <span className="hint" id={hintId}>{field.help}</span>}
        {error && <p className="field-error" id={errId}>{error}</p>}
      </div>
    );
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {field.help && <span className="hint" id={hintId}>{field.help}</span>}
      {field.kind === "long_text" ? (
        <textarea className="textarea" rows={3} maxLength={4000} {...common} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : field.kind === "select" ? (
        <select className="select" {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {field.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          className="input"
          {...common}
          type={field.kind === "date" ? "date" : "text"}
          inputMode={field.kind === "number" ? "decimal" : undefined}
          maxLength={field.kind === "text" ? 200 : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error && <p className="field-error" id={errId}>{error}</p>}
    </div>
  );
}

/** How an answer reads on the ticket. */
export const fieldDisplay = (f: Pick<FieldDef, "kind">, value: string | null) => (value === null ? "—" : f.kind === "checkbox" ? "Yes" : value);
