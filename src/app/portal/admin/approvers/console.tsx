"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert, IconX } from "@/components/icons";
import type { CompanyApprovers } from "@/lib/catalog/approvers";

function Company({ c }: { c: CompanyApprovers }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const act = async (method: "POST" | "DELETE", userId: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/admin/approvers", { method, body: { customerId: c.customerId, userId } });
      setPick("");
      start(() => router.refresh());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || pending;
  return (
    <li className="card tight stack-tight">
      <strong>{c.customerName}</strong>
      {c.approvers.length === 0 ? (
        <p className="subtle">
          No approvers named. {c.fallback === "client_admin" ? "Its client administrators approve." : "It has no client administrator, so Hernandez Solutions approves."}
        </p>
      ) : (
        <ul className="hw-items" role="list">
          {c.approvers.map((a) => (
            <li key={a.userId} className="spread">
              <span>
                {a.name} <span className="subtle">· {a.email} · {a.role}</span>
              </span>
              <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => act("DELETE", a.userId)} aria-label={`Remove ${a.name} as an approver`}>
                <IconX size={14} /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {c.members.length > 0 && (
        <form
          className="row queue-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (pick) act("POST", pick);
          }}
        >
          <label className="sr-only" htmlFor={`add-${c.customerId}`}>Add an approver for {c.customerName}</label>
          <select id={`add-${c.customerId}`} className="select" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Add an approver…</option>
            {c.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name} ({m.role})
              </option>
            ))}
          </select>
          <button type="submit" className="btn" disabled={disabled || !pick}>Add</button>
        </form>
      )}
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
    </li>
  );
}

export function ApproversConsole({ companies }: { companies: CompanyApprovers[] }) {
  if (companies.length === 0) return <p className="muted">No companies yet.</p>;
  return (
    <ul className="stack queue-admin-list">
      {companies.map((c) => (
        <Company key={c.customerId} c={c} />
      ))}
    </ul>
  );
}
