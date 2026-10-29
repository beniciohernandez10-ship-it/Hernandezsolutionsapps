"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { CustomFieldInput, fieldDisplay } from "@/components/custom-field-input";
import { IconAlert } from "@/components/icons";
import type { FieldValue } from "@/lib/fields/kinds";

/** Custom field answers on a ticket; technicians can change them. */
export function FieldsCard({ ticketId, fields, canEdit }: { ticketId: string; fields: FieldValue[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!fields.length) return null;
  const begin = () => {
    setValues(Object.fromEntries(fields.map((f) => [f.id, f.value ?? ""])));
    setError(null);
    setEditing(true);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/tickets/${ticketId}/fields`, { method: "PUT", body: values });
      setEditing(false);
      start(() => router.refresh());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card tight stack-tight fields-card" aria-labelledby="fields-h">
      <div className="spread">
        <h2 id="fields-h" className="eyebrow">More details</h2>
        {canEdit && !editing && (
          <button type="button" className="btn btn-ghost" onClick={begin}>Edit</button>
        )}
      </div>
      {editing ? (
        <form
          className="stack fields-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {fields.map((f) => (
            <CustomFieldInput key={f.id} idPrefix="tf" field={{ ...f, required: false }} value={values[f.id] ?? ""} onChange={(v) => setValues((x) => ({ ...x, [f.id]: v }))} />
          ))}
          {error && (
            <div className="alert alert-danger" role="alert">
              <IconAlert />
              <div>{error}</div>
            </div>
          )}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy || pending}>Save</button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <dl className="kv">
          {fields.map((f) => (
            <div key={f.id} className="kv-row">
              <dt>
                {f.label}
                {f.staffOnly && <span className="subtle"> · technicians only</span>}
              </dt>
              <dd className="prewrap">{fieldDisplay(f, f.value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
