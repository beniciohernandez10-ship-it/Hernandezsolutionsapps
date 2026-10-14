"use client";
import { useEffect, useId, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/components/client-api";

export type PrimaryUserRef =
  | { source: "none" }
  | { source: "directory"; tenantId: string; objectId: string }
  | { source: "portal"; userId: string };

interface Result {
  source: "directory" | "portal";
  notice: string | null;
  users: { key: string; name: string; upn: string; ref: PrimaryUserRef }[];
}

/** Search-as-you-type picker over the customer's Microsoft Entra directory (server-side). */
export function PrimaryUserPicker({
  customerId,
  initial,
  onChange,
}: {
  customerId: string;
  initial?: { name: string; upn: string | null } | null;
  onChange: (ref: PrimaryUserRef) => void;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<{ name: string; upn: string | null } | null>(initial ?? null);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (!customerId || term.length < 2) {
      setResult(null);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const r = await apiFetch<Result>(`/api/assets/directory-users?customerId=${encodeURIComponent(customerId)}&q=${encodeURIComponent(term)}`);
        if (mine === seq.current) setResult(r);
      } catch (err) {
        if (mine === seq.current) setError(err instanceof ApiError ? err.message : "Search failed.");
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, customerId]);

  function choose(u: Result["users"][number] | null) {
    setChosen(u ? { name: u.name, upn: u.upn } : null);
    onChange(u ? u.ref : { source: "none" });
    setQ("");
    setResult(null);
  }

  return (
    <div className="field">
      <label htmlFor={`${id}-q`}>Primary user</label>
      {chosen ? (
        <div className="spread card tight">
          <span>
            <strong>{chosen.name}</strong>
            {chosen.upn && <span className="subtle"> · {chosen.upn}</span>}
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => choose(null)}>Change</button>
        </div>
      ) : (
        <>
          <span className="hint" id={`${id}-hint`}>Search the organization&apos;s Microsoft directory by name or email. Leave empty for a shared device.</span>
          <input
            id={`${id}-q`}
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
            maxLength={64}
            disabled={!customerId}
            aria-describedby={`${id}-hint`}
            aria-controls={`${id}-list`}
            placeholder={customerId ? "Start typing a name…" : "Choose an organization first"}
          />
          <div aria-live="polite" className="subtle">
            {busy ? "Searching…" : error ? error : result?.notice ?? ""}
          </div>
          {result && result.users.length > 0 && (
            <ul id={`${id}-list`} className="picker-list" role="listbox" aria-label="Matching people">
              {result.users.map((u) => (
                <li key={u.key} role="option" aria-selected={false}>
                  <button type="button" className="picker-item" onClick={() => choose(u)}>
                    <strong>{u.name}</strong> <span className="subtle">{u.upn}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {result && result.users.length === 0 && !busy && <p className="subtle">No matches.</p>}
        </>
      )}
    </div>
  );
}
