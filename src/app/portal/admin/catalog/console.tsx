"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError, fieldErrors } from "@/components/client-api";
import { IconAlert, IconCheck } from "@/components/icons";
import { CATEGORIES, CATEGORY_LABEL, PRIORITIES, PRIORITY_LABEL } from "@/lib/tickets/schemas";
import { FIELD_TYPES, type CatalogField, type FieldType } from "@/lib/catalog/fields";
import type { CatalogItem } from "@/lib/catalog/service";
import { StepsEditor, type Candidate } from "./steps";

const TYPE_LABEL: Record<FieldType, string> = {
  text: "Short text",
  textarea: "Long text",
  email: "Email",
  date: "Date",
  number: "Number",
  select: "Choice",
  checkbox: "Yes / no",
};

const keyFrom = (label: string, taken: Set<string>) => {
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 36) || "field";
  if (!/^[a-z]/.test(base)) base = `f_${base}`;
  let k = base;
  for (let i = 2; taken.has(k); i++) k = `${base}_${i}`;
  return k;
};

type Draft = Omit<CatalogItem, "id"> & { id: string | null };

const blank = (): Draft => ({
  id: null,
  customerId: null,
  name: "",
  summary: "",
  category: "general",
  defaultPriority: "normal",
  fields: [{ key: "details", label: "Details", type: "textarea", required: true }],
  tasks: [],
  requiresApproval: false,
  approvalSteps: [],
  workflow: "standard",
  active: true,
  sortOrder: 100,
});

function Editor({ initial, customers, candidates, onClose }: { initial: Draft; customers: { id: string; name: string }[]; candidates: Candidate[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [d, setD] = useState<Draft>(initial);
  const [tasks, setTasks] = useState(initial.tasks.join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setField = (i: number, patch: Partial<CatalogField>) => set("fields", d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, by: number) => {
    const next = [...d.fields];
    const [f] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, f);
    set("fields", next);
  };

  async function save() {
    setBusy(true);
    setError(null);
    setFields({});
    setSaved(false);
    const body = {
      customerId: d.customerId,
      name: d.name,
      summary: d.summary,
      category: d.category,
      defaultPriority: d.defaultPriority,
      fields: d.fields.map((f) => ({ ...f, options: f.type === "select" ? f.options : undefined, help: f.help || undefined })),
      tasks: tasks.split("\n").map((t) => t.trim()).filter(Boolean),
      requiresApproval: d.requiresApproval,
      approvalSteps: d.approvalSteps.map((st) => ({ ...st, name: st.name.trim() || "Approval" })),
      workflow: d.workflow,
      active: d.active,
      sortOrder: d.sortOrder,
    };
    try {
      await apiFetch(d.id ? `/api/admin/catalog/${d.id}` : "/api/admin/catalog", { method: d.id ? "PUT" : "POST", body });
      setSaved(true);
      start(() => router.refresh());
      if (!d.id) onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
      setFields(fieldErrors(e));
    } finally {
      setBusy(false);
    }
  }

  const k = d.id ?? "new";
  return (
    <div className="stack">
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor={`n-${k}`}>Name</label>
          <input id={`n-${k}`} className="input" value={d.name} maxLength={120} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`s-${k}`}>One-line description</label>
          <input id={`s-${k}`} className="input" value={d.summary} maxLength={300} onChange={(e) => set("summary", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`c-${k}`}>Offered to</label>
          <select id={`c-${k}`} className="select" value={d.customerId ?? ""} onChange={(e) => set("customerId", e.target.value || null)}>
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name} only</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`cat-${k}`}>Category</label>
          <select id={`cat-${k}`} className="select" value={d.category} onChange={(e) => set("category", e.target.value as Draft["category"])}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`p-${k}`}>Default priority</label>
          <select id={`p-${k}`} className="select" value={d.defaultPriority} onChange={(e) => set("defaultPriority", e.target.value as Draft["defaultPriority"])}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`o-${k}`}>Order (lower shows first)</label>
          <input id={`o-${k}`} className="input" type="number" min={0} max={10000} value={d.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} />
        </div>
      </div>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={d.requiresApproval} onChange={(e) => set("requiresApproval", e.target.checked)} /> Needs the client&apos;s approval
        </label>
        <label className="check">
          <input type="checkbox" checked={d.active} onChange={(e) => set("active", e.target.checked)} /> Offered to clients
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={d.workflow === "hardware"}
            onChange={(e) => setD((x) => ({ ...x, workflow: e.target.checked ? "hardware" : "standard", requiresApproval: e.target.checked || x.requiresApproval }))}
          />{" "}
          Hardware order
        </label>
      </div>
      {d.workflow === "hardware" && (
        <p className="subtle">
          Approved requests go to the ordering queue. Staff record the order, scan each item&apos;s serial number when it arrives (which registers
          it as an asset for the requester), and the request moves to the technicians&apos; queue for delivery. Queues are set under Administration
          → Queues.
        </p>
      )}

      <fieldset className="stack">
        <legend className="label">Questions</legend>
        {d.fields.map((f, i) => (
          <div key={i} className="field-editor">
            <input aria-label={`Question ${i + 1} label`} className="input" value={f.label} maxLength={120} onChange={(e) => setField(i, { label: e.target.value })} />
            <select aria-label={`Question ${i + 1} type`} className="select" value={f.type} onChange={(e) => setField(i, { type: e.target.value as FieldType, options: e.target.value === "select" ? (f.options ?? ["Option 1", "Option 2"]) : undefined })}>
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </select>
            <label className="check">
              <input type="checkbox" checked={f.required} onChange={(e) => setField(i, { required: e.target.checked })} /> Required
            </label>
            <span className="row">
              <button type="button" className="btn btn-ghost" aria-label={`Move question ${i + 1} up`} onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button type="button" className="btn btn-ghost" aria-label={`Move question ${i + 1} down`} onClick={() => move(i, 1)} disabled={i === d.fields.length - 1}>↓</button>
              <button type="button" className="btn btn-ghost" aria-label={`Remove question ${i + 1}`} onClick={() => set("fields", d.fields.filter((_, j) => j !== i))}>Remove</button>
            </span>
            {f.type === "select" && (
              <input
                aria-label={`Question ${i + 1} choices, separated by commas`}
                className="input field-editor-wide"
                placeholder="Choices, separated by commas"
                value={(f.options ?? []).join(", ")}
                onChange={(e) => setField(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })}
              />
            )}
            <input aria-label={`Question ${i + 1} help text`} className="input field-editor-wide" placeholder="Help text (optional)" maxLength={200} value={f.help ?? ""} onChange={(e) => setField(i, { help: e.target.value })} />
          </div>
        ))}
        <button
          type="button"
          className="btn"
          disabled={d.fields.length >= 30}
          onClick={() => set("fields", [...d.fields, { key: keyFrom("Question", new Set(d.fields.map((f) => f.key))), label: "New question", type: "text", required: false }])}
        >
          Add a question
        </button>
      </fieldset>

      {(d.requiresApproval || d.approvalSteps.length > 0) && (
        <StepsEditor
          steps={d.approvalSteps}
          onChange={(st) => set("approvalSteps", st)}
          questions={d.fields.map((f) => f.label.trim()).filter(Boolean)}
          candidates={candidates}
          customerId={d.customerId}
          idPrefix={k}
        />
      )}

      <div className="field">
        <label htmlFor={`t-${k}`}>Technician checklist (one task per line)</label>
        <textarea id={`t-${k}`} className="textarea" rows={5} value={tasks} onChange={(e) => setTasks(e.target.value)} />
      </div>
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>
            {error}
            {Object.values(fields).length > 0 && (
              <ul>
                {Object.entries(fields).map(([p, m]) => (
                  <li key={p}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy || pending} onClick={save}>
          {busy && <span className="spinner" aria-hidden />}
          {d.id ? "Save" : "Create request type"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>{d.id ? "Close" : "Cancel"}</button>
        {saved && (
          <span className="subtle" role="status">
            <IconCheck size={14} /> Saved
          </span>
        )}
      </div>
    </div>
  );
}

export function CatalogConsole({ items, customers, candidates }: { items: CatalogItem[]; customers: { id: string; name: string }[]; candidates: Candidate[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const customerName = (id: string | null) => (id ? (customers.find((c) => c.id === id)?.name ?? "One customer") : "All customers");
  return (
    <div className="stack">
      <ul className="stack" role="list">
        {items.map((i) => (
          <li key={i.id} className="card stack">
            <div className="spread">
              <div>
                <strong>{i.name}</strong>
                <p className="subtle">
                  {customerName(i.customerId)} · {i.fields.length} questions · {i.tasks.length} tasks
                  {i.approvalSteps.length > 1 ? ` · ${i.approvalSteps.length} approval steps` : i.requiresApproval ? " · needs approval" : ""}
                  {i.workflow === "hardware" ? " · hardware order" : ""}
                  {i.active ? "" : " · hidden"}
                </p>
              </div>
              {open !== i.id && (
                <button type="button" className="btn" onClick={() => setOpen(i.id)}>Edit</button>
              )}
            </div>
            {open === i.id && <Editor initial={{ ...i, id: i.id }} customers={customers} candidates={candidates} onClose={() => setOpen(null)} />}
          </li>
        ))}
      </ul>
      {open === "new" ? (
        <div className="card stack">
          <h2>New request type</h2>
          <Editor initial={blank()} customers={customers} candidates={candidates} onClose={() => setOpen(null)} />
        </div>
      ) : (
        <button type="button" className="btn" onClick={() => setOpen("new")}>Add a request type</button>
      )}
    </div>
  );
}
