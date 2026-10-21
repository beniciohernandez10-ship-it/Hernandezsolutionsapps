"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError, fieldErrors } from "@/components/client-api";
import { IconAlert } from "@/components/icons";

export interface ChangeDraft {
  id: string | null;
  customerId: string;
  title: string;
  description: string;
  changeType: "standard" | "normal" | "emergency";
  risk: "low" | "medium" | "high";
  impact: string;
  implementationPlan: string;
  backoutPlan: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  notifyCustomer: boolean;
  implementerUserId: string | null;
}

/** ISO instant → value for <input type="datetime-local"> in the browser's time zone. */
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

export function ChangeForm({
  initial,
  customers,
  staffByCustomer,
}: {
  initial: ChangeDraft;
  customers: { id: string; name: string }[];
  staffByCustomer: Record<string, { id: string; name: string }[]>;
}) {
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [start, setStart] = useState(toLocal(initial.plannedStart));
  const [end, setEnd] = useState(toLocal(initial.plannedEnd));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof ChangeDraft>(k: K, v: ChangeDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const staff = staffByCustomer[d.customerId] ?? [];
  const err = (k: string) => (errors[k] ? <p className="field-error"><IconAlert size={16} /> {errors[k]}</p> : null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    const { id, ...body } = d;
    try {
      const r = await apiFetch<{ id?: string }>(id ? `/api/changes/${id}` : "/api/changes", {
        method: id ? "PUT" : "POST",
        body: { ...body, plannedStart: fromLocal(start), plannedEnd: fromLocal(end) },
      });
      router.push(`/portal/changes/${id ?? r.id}`, { transitionTypes: ["nav-forward"] } as never);
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : "Couldn't save.");
      setErrors(fieldErrors(ex));
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={save} noValidate>
      {!d.id && customers.length > 1 && (
        <div className="field">
          <label htmlFor="ch-cust">Client</label>
          <select id="ch-cust" className="select" value={d.customerId} onChange={(e) => setD((x) => ({ ...x, customerId: e.target.value, implementerUserId: null }))}>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor="ch-title">Title</label>
        <input id="ch-title" className="input" value={d.title} maxLength={200} onChange={(e) => set("title", e.target.value)} />
        {err("title")}
      </div>
      <div className="field">
        <label htmlFor="ch-desc">What is changing and why</label>
        <textarea id="ch-desc" className="textarea" rows={4} maxLength={20000} value={d.description} onChange={(e) => set("description", e.target.value)} />
        {err("description")}
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="ch-type">Type</label>
          <select id="ch-type" className="select" value={d.changeType} onChange={(e) => set("changeType", e.target.value as ChangeDraft["changeType"])}>
            <option value="standard">Standard (routine, pre-approved)</option>
            <option value="normal">Normal (client approves)</option>
            <option value="emergency">Emergency (service manager approves)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="ch-risk">Risk</label>
          <select id="ch-risk" className="select" value={d.risk} onChange={(e) => set("risk", e.target.value as ChangeDraft["risk"])}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="ch-start">Window starts (your time)</label>
          <input id="ch-start" className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ch-end">Window ends</label>
          <input id="ch-end" className="input" type="datetime-local" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
          {err("plannedEnd")}
        </div>
        <div className="field">
          <label htmlFor="ch-impl">Technician doing the work</label>
          <select id="ch-impl" className="select" value={d.implementerUserId ?? ""} onChange={(e) => set("implementerUserId", e.target.value || null)}>
            <option value="">Not decided</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="ch-impact">What people will notice</label>
        <span className="hint" id="ch-impact-hint">Shown to the client. For example: &quot;Internet is down for about 30 minutes.&quot;</span>
        <textarea id="ch-impact" className="textarea" rows={2} maxLength={5000} aria-describedby="ch-impact-hint" value={d.impact} onChange={(e) => set("impact", e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ch-plan">Implementation plan</label>
        <textarea id="ch-plan" className="textarea" rows={5} maxLength={20000} value={d.implementationPlan} onChange={(e) => set("implementationPlan", e.target.value)} />
        {err("implementationPlan")}
      </div>
      <div className="field">
        <label htmlFor="ch-backout">Backout plan</label>
        <textarea id="ch-backout" className="textarea" rows={3} maxLength={20000} value={d.backoutPlan} onChange={(e) => set("backoutPlan", e.target.value)} />
      </div>
      <label className="check">
        <input type="checkbox" checked={d.notifyCustomer} onChange={(e) => set("notifyCustomer", e.target.checked)} /> Tell the client&apos;s administrators when it&apos;s scheduled and when it&apos;s done
      </label>
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy && <span className="spinner" aria-hidden />}
          {d.id ? "Save" : "Save draft"}
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => router.back()} disabled={busy}>Cancel</button>
      </div>
      <p className="subtle">Saving keeps it as a draft. Submit it from the change page once the window and plans are filled in.</p>
    </form>
  );
}
