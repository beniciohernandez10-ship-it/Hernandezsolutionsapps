"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert, IconCheck, IconClock } from "@/components/icons";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      start(() => router.refresh());
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy: busy || pending, error };
}

const Err = ({ error }: { error: string | null }) =>
  error ? (
    <div className="alert alert-danger" role="alert">
      <IconAlert />
      <div>{error}</div>
    </div>
  ) : null;

export function ChangeApproval(props: { changeId: string; status: string; canDecide: boolean; decidedBy: string | null; note: string | null; approver: string }) {
  const r = useRun();
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);
  const decide = (decision: "approved" | "rejected") =>
    r.run(() => apiFetch(`/api/changes/${props.changeId}/approval`, { method: "POST", body: { decision, ...(note.trim() ? { note: note.trim() } : {}) } }));
  return (
    <section className="card tight stack" aria-labelledby="ch-approval-h">
      <h2 id="ch-approval-h" className="eyebrow">Approval</h2>
      {props.status === "pending" ? (
        <p>
          <IconClock size={14} /> <strong>Waiting for approval</strong> from {props.approver}.
        </p>
      ) : (
        <p>
          {props.status === "approved" ? <IconCheck size={14} /> : <IconAlert size={14} />} <strong>{props.status === "approved" ? "Approved" : "Not approved"}</strong>
          {props.decidedBy && <> by {props.decidedBy}</>}
        </p>
      )}
      {props.note && <p className="prewrap subtle">{props.note}</p>}
      {props.canDecide && (
        <>
          <div className="field">
            <label htmlFor="ch-note">{declining ? "Reason (the technician sees this)" : "Note (optional)"}</label>
            <textarea id="ch-note" className="textarea" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={r.busy} onClick={() => decide("approved")}>Approve</button>
            {declining ? (
              <button type="button" className="btn" disabled={r.busy || !note.trim()} onClick={() => decide("rejected")}>Decline change</button>
            ) : (
              <button type="button" className="btn btn-ghost" disabled={r.busy} onClick={() => setDeclining(true)}>Decline…</button>
            )}
          </div>
        </>
      )}
      <Err error={r.error} />
    </section>
  );
}

const LABEL: Record<string, string> = { submit: "Submit", start: "Start work", complete: "Mark completed", fail: "Mark failed (backed out)", cancel: "Cancel change" };

export function ChangeActions({ changeId, actions }: { changeId: string; actions: string[] }) {
  const r = useRun();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const needsNote = (a: string) => a === "complete" || a === "fail";
  const send = (action: string) =>
    r.run(() => apiFetch(`/api/changes/${changeId}/action`, { method: "POST", body: { action, ...(note.trim() ? { note: note.trim() } : {}) } })).then((ok) => {
      if (ok) {
        setPendingAction(null);
        setNote("");
      }
    });
  return (
    <section className="card tight stack" aria-labelledby="ch-actions-h">
      <h2 id="ch-actions-h" className="eyebrow">Actions</h2>
      {pendingAction ? (
        <div className="stack">
          <div className="field">
            <label htmlFor="ch-outcome">{needsNote(pendingAction) ? "What happened" : "Note (optional)"}</label>
            <textarea id="ch-outcome" className="textarea" rows={3} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={r.busy || (needsNote(pendingAction) && note.trim().length < 5)} onClick={() => send(pendingAction)}>
              {LABEL[pendingAction]}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setPendingAction(null)}>Back</button>
          </div>
        </div>
      ) : (
        <div className="row">
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              className={`btn${a === "submit" || a === "start" || a === "complete" ? " btn-primary" : ""}`}
              disabled={r.busy}
              onClick={() => (a === "submit" || a === "start" ? send(a) : setPendingAction(a))}
            >
              {LABEL[a]}
            </button>
          ))}
        </div>
      )}
      <Err error={r.error} />
    </section>
  );
}

export function ChangeTickets({ changeId, tickets, canEdit }: { changeId: string; tickets: { id: string; number: number; title: string }[]; canEdit: boolean }) {
  const r = useRun();
  const [no, setNo] = useState("");
  return (
    <section className="card tight stack" aria-labelledby="ch-tickets-h">
      <h2 id="ch-tickets-h" className="eyebrow">Related requests</h2>
      {tickets.length === 0 ? (
        <p className="subtle">None linked.</p>
      ) : (
        <ul className="stack" role="list">
          {tickets.map((t) => (
            <li key={t.id} className="spread">
              <Link href={`/portal/tickets/${t.id}`}>#{t.number} {t.title}</Link>
              {canEdit && (
                <button type="button" className="btn btn-ghost" disabled={r.busy} onClick={() => r.run(() => apiFetch(`/api/changes/${changeId}/tickets`, { method: "POST", body: { number: t.number, remove: true } }))}>
                  Unlink
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await r.run(() => apiFetch(`/api/changes/${changeId}/tickets`, { method: "POST", body: { number: Number(no) } }))) setNo("");
          }}
        >
          <label htmlFor="ch-link" className="sr-only">Request number</label>
          <input id="ch-link" className="input input-number" inputMode="numeric" placeholder="Request #" value={no} onChange={(e) => setNo(e.target.value.replace(/\D/g, ""))} />
          <button className="btn" type="submit" disabled={r.busy || !no}>Link</button>
        </form>
      )}
      <Err error={r.error} />
    </section>
  );
}
