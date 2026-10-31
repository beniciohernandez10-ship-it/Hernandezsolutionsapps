"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert } from "@/components/icons";
import type { Delegation } from "@/lib/catalog/workflow";

/** While you're away, someone from your organization decides your approvals. */
export function DelegationForm({ people, delegations, today }: { people: { id: string; name: string }[]; delegations: Delegation[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [delegateUserId, setDelegate] = useState("");
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState("");
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
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        act(
          () => apiFetch("/api/approvals/delegations", { method: "POST", body: { delegateUserId, startsOn, endsOn } }),
          () => {
            setDelegate("");
            setEndsOn("");
          },
        );
      }}
    >
      <p className="subtle">
        Going away? Pick someone to decide your approvals for those dates. They see the requests they&apos;re asked to approve, and each decision shows it
        was made for you. They can&apos;t approve their own requests.
      </p>
      {delegations.length > 0 && (
        <ul className="plain-list delegation-list" role="list">
          {delegations.map((d) => (
            <li key={d.id} className="spread">
              <span>
                <strong>{d.delegateName}</strong> <span className="subtle">{d.startsOn} to {d.endsOn}</span>
              </span>
              <button type="button" className="btn btn-ghost" disabled={busy || pending} onClick={() => act(() => apiFetch(`/api/approvals/delegations/${d.id}`, { method: "DELETE" }))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="del-person">Who decides for you</label>
          <select id="del-person" className="select" value={delegateUserId} required onChange={(e) => setDelegate(e.target.value)}>
            <option value="">Choose…</option>
            {people.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="del-from">From</label>
            <input id="del-from" className="input" type="date" required min={today} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="del-to">To</label>
            <input id="del-to" className="input" type="date" required min={startsOn} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </div>
        </div>
      </div>
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
      <div>
        <button type="submit" className="btn" disabled={busy || pending || !delegateUserId || !endsOn}>Add</button>
      </div>
    </form>
  );
}
