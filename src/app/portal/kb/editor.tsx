"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError, fieldErrors } from "@/components/client-api";
import { Markdown } from "@/components/markdown";
import { IconAlert } from "@/components/icons";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/tickets/schemas";

export interface ArticleDraft {
  id: string | null;
  title: string;
  summary: string;
  body: string;
  category: Category;
  audience: "everyone" | "customer" | "staff";
  customerId: string | null;
  status: "draft" | "published";
}

export function ArticleEditor({ initial, customers, canGlobal }: { initial: ArticleDraft; customers: { id: string; name: string }[]; canGlobal: boolean }) {
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof ArticleDraft>(k: K, v: ArticleDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function save(status: "draft" | "published") {
    setBusy(true);
    setError(null);
    setErrors({});
    const body = { ...d, status, customerId: d.audience === "everyone" ? null : d.customerId };
    try {
      const r = await apiFetch<{ id: string }>(d.id ? `/api/kb/${d.id}` : "/api/kb", { method: d.id ? "PUT" : "POST", body });
      router.push(`/portal/kb/${r.id}`, { transitionTypes: ["nav-forward"] } as never);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
      setErrors(fieldErrors(e));
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={(e) => e.preventDefault()}>
      <div className="field">
        <label htmlFor="kb-title">Title</label>
        <input id="kb-title" className="input" value={d.title} maxLength={200} onChange={(e) => set("title", e.target.value)} />
        {errors.title && <p className="field-error"><IconAlert size={16} /> {errors.title}</p>}
      </div>
      <div className="field">
        <label htmlFor="kb-summary">One-line summary</label>
        <input id="kb-summary" className="input" value={d.summary} maxLength={300} onChange={(e) => set("summary", e.target.value)} />
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="kb-cat">Category</label>
          <select id="kb-cat" className="select" value={d.category} onChange={(e) => set("category", e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="kb-aud">Who can read it</label>
          <select id="kb-aud" className="select" value={d.audience} onChange={(e) => set("audience", e.target.value as ArticleDraft["audience"])}>
            {canGlobal && <option value="everyone">All clients</option>}
            <option value="customer">One client</option>
            <option value="staff">Technicians only</option>
          </select>
        </div>
        {(d.audience === "customer" || d.audience === "staff") && (
          <div className="field">
            <label htmlFor="kb-cust">{d.audience === "customer" ? "Client" : "Client (optional)"}</label>
            <select id="kb-cust" className="select" value={d.customerId ?? ""} onChange={(e) => set("customerId", e.target.value || null)}>
              {d.audience === "staff" && canGlobal && <option value="">All clients</option>}
              {d.audience === "customer" && <option value="">Choose…</option>}
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {errors.customerId && <p className="field-error"><IconAlert size={16} /> {errors.customerId}</p>}
          </div>
        )}
      </div>
      <div className="field">
        <div className="spread">
          <label htmlFor="kb-body">Article</label>
          <div className="tabs" role="group" aria-label="Editor view">
            <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>Write</button>
            <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button>
          </div>
        </div>
        {preview ? (
          <div className="card tight">{d.body.trim() ? <Markdown source={d.body} /> : <p className="subtle">Nothing to preview yet.</p>}</div>
        ) : (
          <>
            <span className="hint" id="kb-body-hint">
              Formatting: ## Heading, - bullet, 1. step, - [ ] checklist, &gt; note, **bold**, `code`, [link](https://…). Never include passwords.
            </span>
            <textarea id="kb-body" className="textarea mono" rows={18} maxLength={50000} aria-describedby="kb-body-hint" value={d.body} onChange={(e) => set("body", e.target.value)} />
          </>
        )}
        {errors.body && <p className="field-error"><IconAlert size={16} /> {errors.body}</p>}
      </div>
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save("published")}>
          {busy && <span className="spinner" aria-hidden />}
          {initial.status === "published" ? "Save" : "Publish"}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => save("draft")}>
          {initial.status === "published" ? "Unpublish (save as draft)" : "Save draft"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
