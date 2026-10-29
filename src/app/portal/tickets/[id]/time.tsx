"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert, IconClock } from "@/components/icons";
import { formatMinutes, parseDuration } from "@/lib/billing/compute";
import type { TimeEntry } from "@/lib/billing/service";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const timerKey = (ticketId: string) => `itc-timer:${ticketId}`;

function readTimer(ticketId: string): number | null {
  try {
    const v = Number(localStorage.getItem(timerKey(ticketId)));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function writeTimer(ticketId: string, start: number | null) {
  try {
    if (start) localStorage.setItem(timerKey(ticketId), String(start));
    else localStorage.removeItem(timerKey(ticketId));
  } catch {
    // Private mode: the timer just won't survive a reload.
  }
}

/** A running timer for this ticket, kept in this browser so it survives reloads. */
function useTimer(ticketId: string) {
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setStart(readTimer(ticketId)), [ticketId]);
  useEffect(() => {
    if (!start) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [start]);
  return {
    running: start !== null,
    elapsedMinutes: start ? Math.max(1, Math.ceil((now - start) / 60000)) : 0,
    elapsedLabel: start ? new Date(Math.max(0, now - start)).toISOString().slice(11, 19) : "",
    begin() {
      const t = Date.now();
      writeTimer(ticketId, t);
      setStart(t);
      setNow(t);
    },
    reset() {
      writeTimer(ticketId, null);
      setStart(null);
    },
  };
}

function EntryRow({ e, onSaved }: { e: TimeEntry; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [duration, setDuration] = useState(formatMinutes(e.minutes));
  const [note, setNote] = useState(e.note ?? "");
  const [billable, setBillable] = useState(e.billable);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  if (editing) {
    return (
      <li className="time-entry stack-tight">
        <div className="row">
          <input className="input time-duration" aria-label="Time spent" value={duration} onChange={(x) => setDuration(x.target.value)} />
          <label className="check">
            <input type="checkbox" checked={billable} onChange={(x) => setBillable(x.target.checked)} /> Billable
          </label>
        </div>
        <input className="input" aria-label="Note" value={note} maxLength={1000} placeholder="What was done" onChange={(x) => setNote(x.target.value)} />
        {error && <p className="field-error"><IconAlert size={14} /> {error}</p>}
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => apiFetch(`/api/time/${e.id}`, { method: "PATCH", body: { minutes: duration, note, billable } }))}>
            Save
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => apiFetch(`/api/time/${e.id}`, { method: "DELETE" }))}>
            Delete
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </li>
    );
  }
  return (
    <li className="time-entry">
      <div className="spread">
        <strong className="mono-text">{formatMinutes(e.minutes)}</strong>
        <span className="subtle">
          {e.userName} · {e.workDate}
          {!e.billable && " · not billable"}
          {e.billed && " · invoiced"}
        </span>
      </div>
      {e.note && <p className="subtle prewrap">{e.note}</p>}
      {e.canEdit && (
        <button type="button" className="btn btn-ghost time-edit" onClick={() => setEditing(true)} aria-label={`Edit ${formatMinutes(e.minutes)} on ${e.workDate}`}>
          Edit
        </button>
      )}
    </li>
  );
}

export function TimeCard({ ticketId, entries, totalMinutes, billableMinutes }: { ticketId: string; entries: TimeEntry[]; totalMinutes: number; billableMinutes: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const timer = useTimer(ticketId);
  const [duration, setDuration] = useState("");
  const [date, setDate] = useState(today);
  const [billable, setBillable] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => start(() => router.refresh());
  const parsed = parseDuration(duration);

  async function log() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/tickets/${ticketId}/time`, { method: "POST", body: { minutes: duration, workDate: date, billable, note } });
      setDuration("");
      setNote("");
      timer.reset();
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't log the time.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card tight stack" aria-labelledby="time-h">
      <div className="spread">
        <h2 id="time-h" className="eyebrow">Time</h2>
        {totalMinutes > 0 && (
          <span className="subtle">
            {formatMinutes(totalMinutes)} total{billableMinutes !== totalMinutes && ` · ${formatMinutes(billableMinutes)} billable`}
          </span>
        )}
      </div>
      <form
        className="stack-tight time-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed) log();
        }}
      >
        <div className="row time-quick" role="group" aria-label="Quick durations">
          {["15m", "30m", "1h"].map((d) => (
            <button key={d} type="button" className="btn" aria-pressed={duration === d} onClick={() => setDuration(d)}>
              {d}
            </button>
          ))}
          {timer.running ? (
            <button type="button" className="btn" onClick={() => setDuration(`${timer.elapsedMinutes}m`)} title="Use the timer's time">
              <IconClock size={14} /> <span className="mono-text">{timer.elapsedLabel}</span> · Use
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={timer.begin}>
              <IconClock size={14} /> Start timer
            </button>
          )}
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor={`dur-${ticketId}`}>Time spent</label>
            <input
              id={`dur-${ticketId}`}
              className="input"
              value={duration}
              placeholder="e.g. 45m or 1h 30m"
              onChange={(e) => setDuration(e.target.value)}
              aria-invalid={duration !== "" && !parsed}
            />
            {duration !== "" && !parsed && <span className="hint">Try 30m, 1h or 1h 30m.</span>}
          </div>
          <div className="field">
            <label htmlFor={`date-${ticketId}`}>Date</label>
            <input id={`date-${ticketId}`} className="input" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor={`note-${ticketId}`}>Note (optional)</label>
          <input id={`note-${ticketId}`} className="input" value={note} maxLength={1000} placeholder="What was done" onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} /> Billable
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || pending || !parsed}>
            {busy && <span className="spinner" aria-hidden />}
            Log {parsed ? formatMinutes(parsed) : "time"}
          </button>
          {timer.running && (
            <button type="button" className="btn btn-ghost" onClick={timer.reset}>
              Discard timer
            </button>
          )}
        </div>
        {error && (
          <div className="alert alert-danger" role="alert">
            <IconAlert />
            <div>{error}</div>
          </div>
        )}
      </form>
      {entries.length > 0 && (
        <ul className="time-list" role="list">
          {entries.map((e) => (
            <EntryRow key={e.id} e={e} onSaved={refresh} />
          ))}
        </ul>
      )}
    </section>
  );
}
