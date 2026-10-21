"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert } from "@/components/icons";

const STATUSES = [
  ["investigating", "Investigating"],
  ["identified", "Cause identified"],
  ["monitoring", "Fix applied, monitoring"],
  ["resolved", "Resolved"],
] as const;

export function IncidentUpdateForm({ id, linkedCount }: { id: string; linkedCount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<string>("identified");
  const [body, setBody] = useState("");
  const [resolveTickets, setResolveTickets] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await apiFetch(`/api/incidents/${id}/updates`, { method: "POST", body: { status, body, resolveTickets: status === "resolved" && resolveTickets } });
          setBody("");
          start(() => router.refresh());
        } catch (ex) {
          setError(ex instanceof ApiError ? ex.message : "Couldn't post the update.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Post an update</h2>
      <div className="field">
        <label htmlFor="inc-status">Status</label>
        <select id="inc-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="inc-body">Update</label>
        <span className="hint" id="inc-body-hint">
          Clients see this on the status page{linkedCount ? `, and it's added to the ${linkedCount} linked request${linkedCount === 1 ? "" : "s"}` : ""}. Keep it plain and factual.
        </span>
        <textarea id="inc-body" className="textarea" rows={4} maxLength={5000} aria-describedby="inc-body-hint" value={body} onChange={(e) => setBody(e.target.value)} required />
      </div>
      {status === "resolved" && linkedCount > 0 && (
        <label className="check">
          <input type="checkbox" checked={resolveTickets} onChange={(e) => setResolveTickets(e.target.checked)} /> Also resolve the linked requests with this update
        </label>
      )}
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={busy || pending || !body.trim()}>Post update</button>
      </div>
    </form>
  );
}
