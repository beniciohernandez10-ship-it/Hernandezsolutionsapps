"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError, fieldErrors } from "@/components/client-api";
import { IconAlert } from "@/components/icons";
import type { CatalogField } from "@/lib/catalog/fields";

export function CatalogRequestForm({ itemId, fields, orgs }: { itemId: string; fields: CatalogField[]; orgs: { id: string; name: string }[] }) {
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [customerId, setCustomerId] = useState(orgs.length === 1 ? orgs[0].id : "");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const answers: Record<string, string | boolean> = {};
    for (const f of fields) answers[f.key] = f.type === "checkbox" ? fd.get(f.key) === "on" : String(fd.get(f.key) ?? "");
    const local: Record<string, string> = {};
    for (const f of fields) if (f.required && f.type !== "checkbox" && !String(answers[f.key]).trim()) local[`answers.${f.key}`] = `${f.label} is required.`;
    if (!customerId) local.customerId = "Choose an organization.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    setFormError(null);
    try {
      const r = await apiFetch<{ id: string }>(`/api/catalog/${itemId}/requests`, {
        method: "POST",
        body: { customerId, answers, notes: String(fd.get("__notes") ?? "") || undefined },
        headers: { "idempotency-key": idempotencyKey },
      });
      router.push(`/portal/tickets/${r.id}?created=1`, { transitionTypes: ["nav-forward"] } as never);
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  const errorFor = (k: string) =>
    errors[k] ? (
      <p className="field-error" id={`${k.replace(".", "-")}-err`}>
        <IconAlert size={16} /> {errors[k]}
      </p>
    ) : null;

  return (
    <form className="card stack" onSubmit={onSubmit} noValidate>
      {formError && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>
            <strong>Your request wasn&apos;t submitted</strong>
            {formError} Your answers are still here.
          </div>
        </div>
      )}
      {orgs.length > 1 && (
        <div className="field">
          <label htmlFor="customerId">Organization</label>
          <select id="customerId" className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Choose…</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          {errorFor("customerId")}
        </div>
      )}
      {fields.map((f) => {
        const k = `answers.${f.key}`;
        const id = `f-${f.key}`;
        const describedBy = [f.help ? `${id}-hint` : "", errors[k] ? `answers-${f.key}-err` : ""].filter(Boolean).join(" ") || undefined;
        const common = { id, name: f.key, "aria-invalid": Boolean(errors[k]), "aria-describedby": describedBy, required: f.required };
        if (f.type === "checkbox") {
          return (
            <div className="field" key={f.key}>
              <label className="check">
                <input type="checkbox" name={f.key} /> {f.label}
              </label>
              {f.help && <span className="hint" id={`${id}-hint`}>{f.help}</span>}
            </div>
          );
        }
        return (
          <div className="field" key={f.key}>
            <label htmlFor={id}>
              {f.label}
              {!f.required && <span className="subtle"> (optional)</span>}
            </label>
            {f.help && <span className="hint" id={`${id}-hint`}>{f.help}</span>}
            {f.type === "textarea" ? (
              <textarea className="textarea" maxLength={5000} {...common} />
            ) : f.type === "select" ? (
              <select className="select" defaultValue="" {...common}>
                <option value="">Choose…</option>
                {f.options?.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input className="input" type={f.type === "number" ? "text" : f.type} inputMode={f.type === "number" ? "decimal" : undefined} maxLength={500} autoComplete="off" {...common} />
            )}
            {errorFor(k)}
          </div>
        );
      })}
      <div className="field">
        <label htmlFor="f-notes">
          Anything else? <span className="subtle">(optional)</span>
        </label>
        <span className="hint" id="f-notes-hint">Never include passwords.</span>
        <textarea id="f-notes" name="__notes" className="textarea" maxLength={5000} aria-describedby="f-notes-hint" />
      </div>
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy && <span className="spinner" aria-hidden />} {busy ? "Submitting…" : "Submit request"}
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => router.back()} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
