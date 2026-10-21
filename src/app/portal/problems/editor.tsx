"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert, IconCheck } from "@/components/icons";

export interface ProblemDraft {
  id: string | null;
  customerId: string | null;
  title: string;
  description: string;
  status: "investigating" | "known_error" | "resolved";
  rootCause: string;
  workaround: string;
  permanentFix: string;
  ownerUserId: string | null;
  version?: number;
  kbArticleId?: string | null;
}

export function ProblemEditor({ initial, customers, staff }: { initial: ProblemDraft; customers: { id: string; name: string }[]; staff: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof ProblemDraft>(k: K, v: ProblemDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const { id, kbArticleId: _kb, version, ...body } = d;
    void _kb;
    try {
      if (id) {
        const r = await apiFetch<{ version: number }>(`/api/problems/${id}`, { method: "PUT", body: { ...body, expectedVersion: version } });
        setD((x) => ({ ...x, version: r.version }));
        setSaved(true);
        start(() => router.refresh());
      } else {
        const r = await apiFetch<{ id: string }>("/api/problems", { method: "POST", body });
        router.push(`/portal/problems/${r.id}`, { transitionTypes: ["nav-forward"] } as never);
      }
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  async function article() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ articleId: string }>(`/api/problems/${d.id}/article`, { method: "POST" });
      router.push(`/portal/kb/${r.articleId}/edit`, { transitionTypes: ["nav-forward"] } as never);
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : "Couldn't create the article.");
      setBusy(false);
    }
  }

  const area = (k: "description" | "rootCause" | "workaround" | "permanentFix", label: string, hint?: string) => (
    <div className="field">
      <label htmlFor={`p-${k}`}>{label}</label>
      {hint && <span className="hint">{hint}</span>}
      <textarea id={`p-${k}`} className="textarea" rows={3} maxLength={20000} value={d[k]} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  return (
    <form className="card stack" onSubmit={save}>
      <div className="field">
        <label htmlFor="p-title">Title</label>
        <input id="p-title" className="input" value={d.title} maxLength={200} onChange={(e) => set("title", e.target.value)} required />
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="p-cust">Client</label>
          <select id="p-cust" className="select" value={d.customerId ?? ""} onChange={(e) => set("customerId", e.target.value || null)}>
            <option value="">Several clients</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="p-status">Status</label>
          <select id="p-status" className="select" value={d.status} onChange={(e) => set("status", e.target.value as ProblemDraft["status"])}>
            <option value="investigating">Investigating</option>
            <option value="known_error">Known error (cause and workaround known)</option>
            <option value="resolved">Resolved (permanent fix in place)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="p-owner">Owner</label>
          <select id="p-owner" className="select" value={d.ownerUserId ?? ""} onChange={(e) => set("ownerUserId", e.target.value || null)}>
            <option value="">Nobody</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>
      {area("description", "What's happening")}
      {area("rootCause", "Root cause", "Required for a known error.")}
      {area("workaround", "Workaround", "What people can do until it's fixed. Required for a known error.")}
      {area("permanentFix", "Permanent fix", "Required to resolve.")}
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={busy || pending}>{d.id ? "Save" : "Record problem"}</button>
        {d.id && d.workaround.trim() && (
          d.kbArticleId ? (
            <Link className="btn" href={`/portal/kb/${d.kbArticleId}`}>Open the workaround article</Link>
          ) : (
            <button type="button" className="btn" disabled={busy || pending} onClick={article}>Draft a knowledge article from the workaround</button>
          )
        )}
        {saved && (
          <span className="subtle" role="status">
            <IconCheck size={14} /> Saved
          </span>
        )}
      </div>
    </form>
  );
}
