"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert, IconCheck } from "@/components/icons";
import { Time } from "@/components/time";
import type { Contract } from "@/lib/billing/service";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(message);
      start(() => router.refresh());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  return { act, busy: busy || pending, error, done };
}

function Feedback({ error, done }: { error: string | null; done: string | null }) {
  return (
    <>
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
      {done && (
        <p className="subtle" role="status">
          <IconCheck size={14} /> {done}
        </p>
      )}
    </>
  );
}

export function MonthActions({
  customerId,
  month,
  finalized,
  canFinalize,
  hasEntries,
}: {
  customerId: string;
  month: string;
  finalized: { at: string; byName: string | null } | null;
  canFinalize: boolean;
  hasEntries: boolean;
}) {
  const a = useAct();
  const url = `/api/admin/billing/${customerId}/months/${month}`;
  return (
    <div className="card tight stack-tight">
      <div className="row">
        <a className="btn" href={url} download>
          Export CSV for invoicing
        </a>
        {finalized ? (
          <button type="button" className="btn btn-ghost" disabled={a.busy} onClick={() => a.act(() => apiFetch(url, { method: "DELETE" }), "Reopened. Entries can be corrected again.")}>
            Reopen month
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={a.busy || !canFinalize || !hasEntries}
            onClick={() => a.act(() => apiFetch(url, { method: "POST" }), "Finalized. This month's time is locked.")}
          >
            Finalize month
          </button>
        )}
      </div>
      <p className="subtle">
        {finalized ? (
          <>
            Finalized <Time iso={finalized.at} />
            {finalized.byName ? ` by ${finalized.byName}` : ""}. The amounts above are what was invoiced, and this month&apos;s time is locked.
          </>
        ) : canFinalize ? (
          "After you invoice, finalize the month: it records the amounts and locks the time so the invoice can't drift."
        ) : (
          "This month is still in progress. Finalize it once it has ended and you've invoiced."
        )}
      </p>
      <Feedback error={a.error} done={a.done} />
    </div>
  );
}

const hoursOf = (minutes: number) => String(+(minutes / 60).toFixed(2));
const dollarsOf = (cents: number) => (cents / 100).toFixed(2);

export function ContractForm({ customerId, contract }: { customerId: string; contract: Contract | null }) {
  const a = useAct();
  const [kind, setKind] = useState<Contract["kind"]>(contract?.kind ?? "retainer");
  const [name, setName] = useState(contract?.name ?? "Managed IT");
  const [fee, setFee] = useState(contract ? dollarsOf(contract.monthlyFeeCents) : "");
  const [hours, setHours] = useState(contract && contract.kind !== "hourly" ? hoursOf(contract.includedMinutes) : "");
  const [rate, setRate] = useState(contract ? dollarsOf(contract.hourlyRateCents) : "");
  const [rounding, setRounding] = useState(String(contract?.roundingMinutes ?? 15));
  const [startsOn, setStartsOn] = useState(contract?.startsOn ?? new Date().toISOString().slice(0, 10));
  const [endsOn, setEndsOn] = useState(contract?.endsOn ?? "");
  const [notes, setNotes] = useState(contract?.notes ?? "");
  const base = `/api/admin/billing/${customerId}/contract`;

  return (
    <form
      className="card tight stack"
      onSubmit={(e) => {
        e.preventDefault();
        a.act(
          () =>
            apiFetch(base, {
              method: "PUT",
              body: { name, kind, monthlyFee: fee || 0, includedHours: hours || 0, hourlyRate: rate || 0, roundingMinutes: rounding, startsOn, endsOn: endsOn || null, notes },
            }),
          "Plan saved.",
        );
      }}
    >
      <fieldset className="field">
        <legend className="label">How this client is billed</legend>
        <div className="tabs" role="group" aria-label="Plan type">
          {(
            [
              ["retainer", "Monthly retainer"],
              ["block", "Block of hours"],
              ["hourly", "Hourly"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
        <span className="hint">
          {kind === "retainer" && "A fixed monthly fee that includes a number of hours each month; extra time is billed at the hourly rate."}
          {kind === "block" && "Prepaid hours that carry over from month to month until used up; then time is billed at the hourly rate."}
          {kind === "hourly" && "Every billable minute is billed at the hourly rate."}
        </span>
      </fieldset>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="c-name">Plan name</label>
          <input id="c-name" className="input" value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} />
        </div>
        {kind === "retainer" && (
          <div className="field">
            <label htmlFor="c-fee">Monthly fee (USD)</label>
            <input id="c-fee" className="input" inputMode="decimal" value={fee} placeholder="1500" onChange={(e) => setFee(e.target.value)} />
          </div>
        )}
        {kind !== "hourly" && (
          <div className="field">
            <label htmlFor="c-hours">{kind === "block" ? "Hours in the block" : "Hours included per month"}</label>
            <input id="c-hours" className="input" inputMode="decimal" value={hours} placeholder={kind === "block" ? "20" : "10"} onChange={(e) => setHours(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor="c-rate">{kind === "hourly" ? "Hourly rate (USD)" : "Rate for extra time (USD/hour)"}</label>
          <input id="c-rate" className="input" inputMode="decimal" value={rate} placeholder="125" required onChange={(e) => setRate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="c-round">Round each entry up to</label>
          <select id="c-round" className="select" value={rounding} onChange={(e) => setRounding(e.target.value)}>
            <option value="1">The exact minute</option>
            <option value="6">6 minutes (0.1 h)</option>
            <option value="10">10 minutes</option>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="c-start">{kind === "block" ? "Block starts" : "Starts"}</label>
          <input id="c-start" className="input" type="date" value={startsOn} required onChange={(e) => setStartsOn(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="c-end">Ends (optional)</label>
          <input id="c-end" className="input" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="c-notes">Notes (optional)</label>
        <input id="c-notes" className="input" value={notes} maxLength={2000} placeholder="e.g. Signed SOW March 2026" onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={a.busy}>
          {contract ? "Save plan" : "Set plan"}
        </button>
        {contract && (
          <button type="button" className="btn btn-ghost" disabled={a.busy} onClick={() => a.act(() => apiFetch(base, { method: "DELETE" }), "Plan ended. New time won't be charged until a plan is set.")}>
            End plan
          </button>
        )}
      </div>
      <p className="subtle">Saving replaces the current plan (the old one is kept on record). Months already finalized keep the plan they were invoiced under.</p>
      <Feedback error={a.error} done={a.done} />
    </form>
  );
}
