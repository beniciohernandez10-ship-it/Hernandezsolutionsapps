"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert, IconCheck, IconClock } from "@/components/icons";
import { Time } from "@/components/time";
import type { ApprovalInfo, TicketTask } from "@/lib/catalog/read";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
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
  }
  return { run, busy: busy || pending, error };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <div className="alert alert-danger" role="alert">
      <IconAlert />
      <div>{error}</div>
    </div>
  ) : null;
}

export function ApprovalCard({ ticketId, approval }: { ticketId: string; approval: ApprovalInfo }) {
  const r = useRun();
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const decide = (decision: "approved" | "rejected") =>
    r.run(() => apiFetch(`/api/tickets/${ticketId}/approval`, { method: "POST", body: { decision, ...(note.trim() ? { note: note.trim() } : {}) } }));

  if (approval.status !== "pending") {
    return (
      <section className="card tight stack" aria-labelledby="approval-h">
        <h2 id="approval-h" className="eyebrow">Approval</h2>
        <p>
          {approval.status === "approved" ? <IconCheck size={14} /> : <IconAlert size={14} />}{" "}
          <strong>{approval.status === "approved" ? "Approved" : "Not approved"}</strong>
          {approval.decidedByName && <> by {approval.decidedByName}</>}
          {approval.decidedAt && <> · <Time iso={approval.decidedAt} /></>}
        </p>
        {approval.note && <p className="subtle prewrap">{approval.note}</p>}
      </section>
    );
  }
  return (
    <section className="card tight stack" aria-labelledby="approval-h">
      <h2 id="approval-h" className="eyebrow">Approval</h2>
      <p>
        <IconClock size={14} /> <strong>Waiting for approval</strong> from {approval.approverLabel}.
      </p>
      {approval.canDecide && (
        <>
          <div className="field">
            <label htmlFor="approval-note">{rejecting ? "Reason (the requester sees this)" : "Note (optional)"}</label>
            <textarea id="approval-note" className="textarea" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <ErrorLine error={r.error} />
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={r.busy} onClick={() => decide("approved")}>Approve</button>
            {rejecting ? (
              <button type="button" className="btn" disabled={r.busy || !note.trim()} onClick={() => decide("rejected")}>Decline request</button>
            ) : (
              <button type="button" className="btn btn-ghost" disabled={r.busy} onClick={() => setRejecting(true)}>Decline…</button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function TaskList({ ticketId, tasks, canEdit }: { ticketId: string; tasks: TicketTask[]; canEdit: boolean }) {
  const r = useRun();
  const [title, setTitle] = useState("");
  const done = tasks.filter((t) => t.done).length;
  if (!tasks.length && !canEdit) return null;
  return (
    <section className="card tight stack" aria-labelledby="tasks-h">
      <h2 id="tasks-h" className="eyebrow">
        Checklist {tasks.length > 0 && `· ${done} of ${tasks.length} done`}
      </h2>
      {tasks.length > 0 && (
        <ul className="task-list" role="list">
          {tasks.map((t) => (
            <li key={t.id}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={t.done}
                  disabled={!canEdit || r.busy}
                  onChange={(e) => r.run(() => apiFetch(`/api/tickets/${ticketId}/tasks/${t.id}`, { method: "PATCH", body: { done: e.target.checked } }))}
                />
                <span className={t.done ? "done" : ""}>{t.title}</span>
              </label>
              {t.done && t.doneByName && (
                <span className="subtle">
                  {t.doneByName}
                  {t.doneAt && <> · <Time iso={t.doneAt} /></>}
                </span>
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
            if (title.trim() && (await r.run(() => apiFetch(`/api/tickets/${ticketId}/tasks`, { method: "POST", body: { title: title.trim() } })))) setTitle("");
          }}
        >
          <label htmlFor="new-task" className="sr-only">New task</label>
          <input id="new-task" className="input" placeholder="Add a task" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn" type="submit" disabled={r.busy || !title.trim()}>Add</button>
        </form>
      )}
      <ErrorLine error={r.error} />
    </section>
  );
}
