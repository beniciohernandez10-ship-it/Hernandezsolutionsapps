"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert, IconCheck } from "@/components/icons";
import { formatMinutes, parseDuration } from "@/lib/billing/compute";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** Logs time for a client: general work, or against a request number. */
export function AddTime({ clients }: { clients: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [customerId, setCustomerId] = useState(clients.length === 1 ? clients[0].id : "");
  const [ticket, setTicket] = useState("");
  const [duration, setDuration] = useState("");
  const [date, setDate] = useState(today);
  const [billable, setBillable] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const parsed = parseDuration(duration);

  return (
    <form
      className="card tight stack-tight"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!parsed || !customerId) return;
        setBusy(true);
        setError(null);
        setDone(null);
        try {
          await apiFetch("/api/time", {
            method: "POST",
            body: { customerId, ...(ticket.trim() ? { ticketNumber: ticket.trim() } : {}), minutes: duration, workDate: date, billable, note },
          });
          setDone(`Logged ${formatMinutes(parsed)}.`);
          setDuration("");
          setNote("");
          setTicket("");
          start(() => router.refresh());
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Couldn't log the time.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="eyebrow">Log time</h2>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="t-client">Client</label>
          <select id="t-client" className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            <option value="">Choose…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="t-ticket">Request number (optional)</label>
          <input id="t-ticket" className="input" inputMode="numeric" value={ticket} placeholder="e.g. 142, or leave blank for general work" onChange={(e) => setTicket(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="t-dur">Time spent</label>
          <input id="t-dur" className="input" value={duration} placeholder="e.g. 45m or 1h 30m" onChange={(e) => setDuration(e.target.value)} aria-invalid={duration !== "" && !parsed} />
        </div>
        <div className="field">
          <label htmlFor="t-date">Date</label>
          <input id="t-date" className="input" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="t-note">Note</label>
        <input id="t-note" className="input" value={note} maxLength={1000} placeholder="What was done" onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} /> Billable
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || pending || !parsed || !customerId}>
          Log {parsed ? formatMinutes(parsed) : "time"}
        </button>
        {done && (
          <span className="subtle" role="status">
            <IconCheck size={14} /> {done}
          </span>
        )}
      </div>
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
    </form>
  );
}

/** Service managers: whose timesheet to view. */
export function PersonPicker({ people, current, self, week }: { people: { id: string; name: string }[]; current: string; self: string; week: string }) {
  const router = useRouter();
  return (
    <div className="field">
      <label htmlFor="t-person">Timesheet for</label>
      <select
        id="t-person"
        className="select"
        value={current}
        onChange={(e) => router.push(e.target.value === self ? `/portal/time?week=${week}` : `/portal/time?week=${week}&user=${e.target.value}`)}
      >
        {!people.some((x) => x.id === self) && <option value={self}>Me</option>}
        {people.map((x) => (
          <option key={x.id} value={x.id}>{x.id === self ? `${x.name} (me)` : x.name}</option>
        ))}
      </select>
    </div>
  );
}

/** Removes an unbilled entry you're allowed to change (log it again to correct it). */
export function RemoveEntry({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost time-edit"
        disabled={busy || pending}
        aria-label={`Remove ${label}`}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await apiFetch(`/api/time/${id}`, { method: "DELETE" });
            start(() => router.refresh());
          } catch (e) {
            setError(e instanceof ApiError ? e.message : "Couldn't remove it.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Remove
      </button>
      {error && <span className="field-error" role="alert">{error}</span>}
    </>
  );
}
