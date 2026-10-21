"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert } from "@/components/icons";
import { CATEGORIES, CATEGORY_LABEL, PRIORITIES, PRIORITY_LABEL } from "@/lib/tickets/schemas";
import type { AssignmentRule } from "@/lib/productivity/service";

interface Targets {
  staff: { id: string; name: string; customerIds: string[] }[];
  queues: { id: string; name: string }[];
}

type Draft = Omit<AssignmentRule, "id"> & { id: string | null };

const blank = (): Draft => ({
  id: null,
  name: "",
  customerId: null,
  active: true,
  position: 100,
  matchCategory: null,
  matchPriority: null,
  matchKind: null,
  matchKeyword: null,
  assignUserId: null,
  assignQueueId: null,
});

function Editor({ initial, targets, customers, onDone }: { initial: Draft; targets: Targets; customers: { id: string; name: string }[]; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const k = d.id ?? "new";
  const staff = d.customerId ? targets.staff.filter((s) => s.customerIds.includes(d.customerId!)) : targets.staff;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      start(() => router.refresh());
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  const sel = (id: string, label: string, value: string | null, onChange: (v: string | null) => void, options: [string, string][], none: string) => (
    <div className="field">
      <label htmlFor={`${id}-${k}`}>{label}</label>
      <select id={`${id}-${k}`} className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{none}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </div>
  );
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const { id, ...body } = d;
        act(() => apiFetch(id ? `/api/admin/rules/${id}` : "/api/admin/rules", { method: id ? "PUT" : "POST", body: { ...body, matchKeyword: body.matchKeyword?.trim() || null } }));
      }}
    >
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor={`name-${k}`}>Name</label>
          <input id={`name-${k}`} className="input" value={d.name} maxLength={120} required onChange={(e) => set("name", e.target.value)} />
        </div>
        {sel("cust", "Client", d.customerId, (v) => set("customerId", v), customers.map((c) => [c.id, c.name]), "All clients")}
        {sel("cat", "When the category is", d.matchCategory, (v) => set("matchCategory", v), CATEGORIES.map((c) => [c, CATEGORY_LABEL[c]]), "Any category")}
        {sel("pri", "and the priority is", d.matchPriority, (v) => set("matchPriority", v), PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]]), "Any priority")}
        {sel("kind", "and it's", d.matchKind, (v) => set("matchKind", v), [["incident", "A problem report"], ["request", "A catalog request"]], "Either")}
        <div className="field">
          <label htmlFor={`kw-${k}`}>and the text contains (optional)</label>
          <input id={`kw-${k}`} className="input" value={d.matchKeyword ?? ""} maxLength={80} onChange={(e) => set("matchKeyword", e.target.value || null)} />
        </div>
        {sel("user", "Assign to technician", d.assignUserId, (v) => set("assignUserId", v), staff.map((s) => [s.id, s.name]), "Nobody")}
        {sel("queue", "and/or queue", d.assignQueueId, (v) => set("assignQueueId", v), targets.queues.map((q) => [q.id, q.name]), "No queue")}
        <div className="field">
          <label htmlFor={`pos-${k}`}>Order (lower is checked first)</label>
          <input id={`pos-${k}`} className="input" type="number" min={0} max={10000} value={d.position} onChange={(e) => set("position", Number(e.target.value))} />
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={d.active} onChange={(e) => set("active", e.target.checked)} /> Active
      </label>
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={busy || pending || !d.name.trim() || (!d.assignUserId && !d.assignQueueId)}>Save rule</button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>Cancel</button>
        {d.id && (
          <button type="button" className="btn btn-ghost" disabled={busy || pending} onClick={() => act(() => apiFetch(`/api/admin/rules/${d.id}`, { method: "DELETE" }))}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

export function RulesConsole({ rules, targets, customers }: { rules: AssignmentRule[]; targets: Targets; customers: { id: string; name: string }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const who = (r: AssignmentRule) =>
    [r.assignUserId && targets.staff.find((s) => s.id === r.assignUserId)?.name, r.assignQueueId && targets.queues.find((q) => q.id === r.assignQueueId)?.name]
      .filter(Boolean)
      .join(" + ");
  const when = (r: AssignmentRule) =>
    [
      r.customerId ? customers.find((c) => c.id === r.customerId)?.name : "All clients",
      r.matchCategory && CATEGORY_LABEL[r.matchCategory as keyof typeof CATEGORY_LABEL],
      r.matchPriority && PRIORITY_LABEL[r.matchPriority as keyof typeof PRIORITY_LABEL],
      r.matchKind && (r.matchKind === "request" ? "catalog requests" : "problem reports"),
      r.matchKeyword && `contains "${r.matchKeyword}"`,
    ]
      .filter(Boolean)
      .join(" · ");
  return (
    <div className="stack">
      {rules.length === 0 && open !== "new" && <p className="muted">No rules yet. New requests stay unassigned until a technician picks them up.</p>}
      <ul className="stack" role="list">
        {rules.map((r) => (
          <li key={r.id} className="card tight stack">
            {open === r.id ? (
              <Editor initial={r} targets={targets} customers={customers} onDone={() => setOpen(null)} />
            ) : (
              <div className="spread">
                <div>
                  <strong>{r.name}</strong>
                  {!r.active && <span className="badge status-waiting">Off</span>}
                  <p className="subtle">
                    {when(r)} → {who(r) || "—"}
                  </p>
                </div>
                <button type="button" className="btn" onClick={() => setOpen(r.id)}>Edit</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {open === "new" ? (
        <div className="card stack">
          <h2>New rule</h2>
          <Editor initial={blank()} targets={targets} customers={customers} onDone={() => setOpen(null)} />
        </div>
      ) : (
        <button type="button" className="btn" onClick={() => setOpen("new")}>Add a rule</button>
      )}
    </div>
  );
}
