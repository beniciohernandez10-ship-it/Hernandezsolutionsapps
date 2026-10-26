"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert, IconCheck } from "@/components/icons";
import type { QueueAdminRow } from "@/lib/queues/service";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
      start(() => router.refresh());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  return { act, busy: busy || pending, error };
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="alert alert-danger" role="alert">
      <IconAlert />
      <div>{error}</div>
    </div>
  );
}

function QueueRow({ q, others }: { q: QueueAdminRow; others: QueueAdminRow[] }) {
  const { act, busy, error } = useAct();
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [name, setName] = useState(q.name);
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? "");
  const used = q.totalTickets > 0 || q.rules > 0;
  return (
    <li className="card tight stack-tight">
      <div className="spread">
        <div>
          <strong>{q.name}</strong>
          <div className="subtle">
            {q.activeTickets} open · {q.totalTickets} in total · {q.rules === 0 ? "no assignment rules" : `${q.rules} assignment ${q.rules === 1 ? "rule" : "rules"}`}
          </div>
        </div>
        {mode === "view" && (
          <div className="row">
            <button type="button" className="btn" onClick={() => setMode("rename")}>Rename</button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode("delete")}>Delete</button>
          </div>
        )}
      </div>
      {mode === "rename" && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => apiFetch(`/api/admin/queues/${q.id}`, { method: "PUT", body: { name } }), () => setMode("view"));
          }}
        >
          <label className="sr-only" htmlFor={`name-${q.id}`}>Queue name</label>
          <input id={`name-${q.id}`} className="input" value={name} maxLength={60} required autoFocus onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={busy || name.trim().length < 2}>Save</button>
          <button type="button" className="btn btn-ghost" onClick={() => { setName(q.name); setMode("view"); }}>Cancel</button>
        </form>
      )}
      {mode === "delete" && (
        <form
          className="stack-tight"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => apiFetch(`/api/admin/queues/${q.id}`, { method: "DELETE", body: { moveTo: moveTo || null } }));
          }}
        >
          {used ? (
            <div className="field">
              <label htmlFor={`move-${q.id}`}>Move its requests and assignment rules to</label>
              <select id={`move-${q.id}`} className="select" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
                <option value="">No queue</option>
              </select>
            </div>
          ) : (
            <p className="subtle">Nothing uses this queue, so deleting it changes no requests.</p>
          )}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy}>Delete {q.name}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode("view")}>Cancel</button>
          </div>
        </form>
      )}
      <ErrorLine error={error} />
    </li>
  );
}

export function QueuesConsole({ queues }: { queues: QueueAdminRow[] }) {
  const { act, busy, error } = useAct();
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <div className="stack">
      <form
        className="card tight stack-tight"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          act(() => apiFetch("/api/admin/queues", { method: "POST", body: { name: n } }), () => {
            setName("");
            setSaved(`Added ${n}.`);
          });
        }}
      >
        <div className="field queue-add">
          <label htmlFor="new-queue">New queue</label>
          <div className="row">
            <input id="new-queue" className="input" value={name} maxLength={60} placeholder="For example, Onboarding" onChange={(e) => { setName(e.target.value); setSaved(null); }} />
            <button type="submit" className="btn btn-primary" disabled={busy || name.trim().length < 2}>Add queue</button>
          </div>
        </div>
        <ErrorLine error={error} />
        {saved && (
          <p className="subtle" role="status">
            <IconCheck size={14} /> {saved}
          </p>
        )}
      </form>
      {queues.length === 0 ? (
        <p className="muted">No queues yet. Requests stay in “No queue” until you add one.</p>
      ) : (
        <ul className="stack queue-admin-list">
          {queues.map((q) => (
            <QueueRow key={q.id} q={q} others={queues.filter((o) => o.id !== q.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}
