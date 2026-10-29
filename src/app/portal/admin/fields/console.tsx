"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert } from "@/components/icons";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/tickets/schemas";
import { FIELD_KINDS, FIELD_KIND_LABEL, type FieldDef, type FieldKind } from "@/lib/fields/kinds";

type Row = FieldDef & { answers: number };
type Draft = Omit<FieldDef, "id" | "options"> & { id: string | null; options: string };

const blank = (): Draft => ({
  id: null, customerId: null, category: null, label: "", help: null, kind: "text", options: "", required: false, staffOnly: false, position: 100, active: true,
});

function Editor({ initial, customers, answers, onDone }: { initial: Draft; customers: { id: string; name: string }[]; answers: number; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const k = d.id ?? "new";
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      start(() => router.refresh());
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? (e.body.fields?.[0]?.message ?? e.message) : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const { id, options, ...body } = d;
        act(() =>
          apiFetch(id ? `/api/admin/fields/${id}` : "/api/admin/fields", {
            method: id ? "PUT" : "POST",
            body: { ...body, help: body.help || null, options: options.split("\n").map((o) => o.trim()).filter(Boolean) },
          }),
        );
      }}
    >
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor={`f-label-${k}`}>Question</label>
          <input id={`f-label-${k}`} className="input" value={d.label} maxLength={80} required placeholder="e.g. Cost center" onChange={(e) => set("label", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`f-kind-${k}`}>Answer type</label>
          <select id={`f-kind-${k}`} className="select" value={d.kind} onChange={(e) => setD((x) => ({ ...x, kind: e.target.value as FieldKind, required: e.target.value === "checkbox" ? false : x.required }))}>
            {FIELD_KINDS.map((t) => (
              <option key={t} value={t}>{FIELD_KIND_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`f-cust-${k}`}>Client</label>
          <select id={`f-cust-${k}`} className="select" value={d.customerId ?? ""} onChange={(e) => set("customerId", e.target.value || null)}>
            <option value="">All clients</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`f-cat-${k}`}>Category</label>
          <select id={`f-cat-${k}`} className="select" value={d.category ?? ""} onChange={(e) => set("category", (e.target.value || null) as Category | null)}>
            <option value="">Every category</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`f-help-${k}`}>Hint (optional)</label>
          <input id={`f-help-${k}`} className="input" value={d.help ?? ""} maxLength={200} onChange={(e) => set("help", e.target.value || null)} />
        </div>
        <div className="field">
          <label htmlFor={`f-pos-${k}`}>Order (lower comes first)</label>
          <input id={`f-pos-${k}`} className="input" type="number" min={0} max={10000} value={d.position} onChange={(e) => set("position", Number(e.target.value))} />
        </div>
      </div>
      {d.kind === "select" && (
        <div className="field">
          <label htmlFor={`f-opts-${k}`}>Choices (one per line)</label>
          <textarea id={`f-opts-${k}`} className="textarea" rows={4} value={d.options} onChange={(e) => set("options", e.target.value)} />
        </div>
      )}
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={d.required} disabled={d.kind === "checkbox" || d.staffOnly} onChange={(e) => set("required", e.target.checked)} /> Required on the request form
        </label>
        <label className="check">
          <input type="checkbox" checked={d.staffOnly} onChange={(e) => setD((x) => ({ ...x, staffOnly: e.target.checked, required: e.target.checked ? false : x.required }))} /> Technicians only (never shown to the client)
        </label>
        <label className="check">
          <input type="checkbox" checked={d.active} onChange={(e) => set("active", e.target.checked)} /> Active
        </label>
      </div>
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={busy || pending || !d.label.trim()}>Save field</button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>Cancel</button>
        {d.id &&
          (confirmDelete ? (
            <>
              <span className="subtle">
                {answers ? `Delete it and ${answers} saved answer${answers === 1 ? "" : "s"}? Turning it off keeps them.` : "Delete this field?"}
              </span>
              <button type="button" className="btn btn-primary" disabled={busy || pending} onClick={() => act(() => apiFetch(`/api/admin/fields/${d.id}`, { method: "DELETE" }))}>
                Delete
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>Delete…</button>
          ))}
      </div>
    </form>
  );
}

export function FieldsConsole({ fields, customers }: { fields: Row[]; customers: { id: string; name: string }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const where = (f: FieldDef) =>
    [f.customerId ? (customers.find((c) => c.id === f.customerId)?.name ?? "A client") : "All clients", f.category ? CATEGORY_LABEL[f.category] : "every category"].join(" · ");
  return (
    <div className="stack">
      {fields.length === 0 && open !== "new" && <p className="muted">No custom fields yet.</p>}
      <ul className="stack queue-admin-list" role="list">
        {fields.map((f) => (
          <li key={f.id} className="card tight stack-tight">
            {open === f.id ? (
              <Editor initial={{ ...f, options: f.options.join("\n") }} customers={customers} answers={f.answers} onDone={() => setOpen(null)} />
            ) : (
              <div className="spread">
                <div>
                  <strong>{f.label}</strong> {!f.active && <span className="badge status-waiting">Off</span>}
                  <div className="subtle">
                    {where(f)} · {FIELD_KIND_LABEL[f.kind]}
                    {f.kind === "select" ? ` (${f.options.join(", ")})` : ""}
                    {f.required ? " · required" : ""}
                    {f.staffOnly ? " · technicians only" : ""} · {f.answers} answer{f.answers === 1 ? "" : "s"}
                  </div>
                </div>
                <button type="button" className="btn" onClick={() => setOpen(f.id)}>Edit</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {open === "new" ? (
        <div className="card stack">
          <h2>New field</h2>
          <Editor initial={blank()} customers={customers} answers={0} onDone={() => setOpen(null)} />
        </div>
      ) : (
        <div>
          <button type="button" className="btn btn-primary" onClick={() => setOpen("new")}>Add a field</button>
        </div>
      )}
    </div>
  );
}
