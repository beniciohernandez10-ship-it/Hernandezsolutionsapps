"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert } from "@/components/icons";

interface Reply {
  id: string;
  customerId: string | null;
  title: string;
  body: string;
}

function Editor({ initial, customers, onDone }: { initial: Reply | null; customers: { id: string; name: string }[]; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = initial?.id ?? "new";
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
  const payload = { title, body, customerId: customerId || null };
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        act(() => apiFetch(initial ? `/api/replies/${initial.id}` : "/api/replies", { method: initial ? "PUT" : "POST", body: payload }));
      }}
    >
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor={`rt-${key}`}>Name</label>
          <input id={`rt-${key}`} className="input" value={title} maxLength={120} required onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`rc-${key}`}>For</label>
          <select id={`rc-${key}`} className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">All clients (shared)</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name} only</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`rb-${key}`}>Reply</label>
        <textarea id={`rb-${key}`} className="textarea" rows={6} maxLength={10000} required value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={busy || pending || !title.trim() || !body.trim()}>Save</button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>Cancel</button>
        {initial && (
          <button type="button" className="btn btn-ghost" disabled={busy || pending} onClick={() => act(() => apiFetch(`/api/replies/${initial.id}`, { method: "DELETE" }))}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

export function RepliesConsole({ items, customers }: { items: Reply[]; customers: { id: string; name: string }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const name = (id: string | null) => (id ? (customers.find((c) => c.id === id)?.name ?? "One client") : "All clients");
  return (
    <div className="stack">
      {items.length === 0 && open !== "new" && <p className="muted">No saved replies yet.</p>}
      <ul className="stack" role="list">
        {items.map((r) => (
          <li key={r.id} className="card tight stack">
            {open === r.id ? (
              <Editor initial={r} customers={customers} onDone={() => setOpen(null)} />
            ) : (
              <div className="spread">
                <div>
                  <strong>{r.title}</strong>
                  <p className="subtle">{name(r.customerId)} · {r.body.slice(0, 120)}{r.body.length > 120 ? "…" : ""}</p>
                </div>
                <button type="button" className="btn" onClick={() => setOpen(r.id)}>Edit</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {open === "new" ? (
        <div className="card stack">
          <h2>New saved reply</h2>
          <Editor initial={null} customers={customers} onDone={() => setOpen(null)} />
        </div>
      ) : (
        <button type="button" className="btn" onClick={() => setOpen("new")}>Add a saved reply</button>
      )}
    </div>
  );
}
