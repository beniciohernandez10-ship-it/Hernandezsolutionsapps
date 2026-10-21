"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert } from "@/components/icons";

/** The wider incident a request belongs to; technicians can link or unlink it. */
export function IncidentCard({
  ticketId,
  incident,
  options,
  canEdit,
}: {
  ticketId: string;
  incident: { id: string; number: number; title: string; status: string } | null;
  options: { id: string; number: number; title: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!incident && (!canEdit || options.length === 0)) return null;
  const link = async (incidentId: string, remove = false) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/incidents/${incidentId}/tickets`, { method: "POST", body: { ticketId, remove } });
      start(() => router.refresh());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card tight stack" aria-labelledby="inc-h">
      <h2 id="inc-h" className="eyebrow">Wider issue</h2>
      {incident ? (
        <p>
          Part of <Link href={`/portal/incidents/${incident.id}`}>INC-{incident.number}: {incident.title}</Link>
          {incident.status === "resolved" ? " (resolved)" : ""}
          {canEdit && (
            <>
              {" "}
              <button type="button" className="btn btn-ghost" disabled={busy || pending} onClick={() => link(incident.id, true)}>Unlink</button>
            </>
          )}
        </p>
      ) : (
        <div className="row">
          <label htmlFor="inc-pick" className="sr-only">Active incident</label>
          <select id="inc-pick" className="select" value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Link to an active incident…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>INC-{o.number}: {o.title}</option>
            ))}
          </select>
          <button type="button" className="btn" disabled={!choice || busy || pending} onClick={() => link(choice)}>Link</button>
        </div>
      )}
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
    </section>
  );
}
