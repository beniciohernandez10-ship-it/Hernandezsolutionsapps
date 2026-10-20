"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError, fieldErrors } from "@/components/client-api";
import { IconAlert, IconCheck } from "@/components/icons";
import { PRIORITIES, PRIORITY_LABEL, type Priority } from "@/lib/tickets/schemas";

interface Policy {
  id: string;
  name: string;
  timeZone: string;
  hours: Partial<Record<string, [string, string][]>>;
  holidays: string[];
  targets: Record<Priority, { firstResponse: number; resolution: number }>;
  warnPercent: number;
  customers: { id: string; name: string }[];
}
interface Customer {
  id: string;
  name: string;
  status: string;
  policyId: string | null;
}

const DAYS = [
  ["1", "Monday"],
  ["2", "Tuesday"],
  ["3", "Wednesday"],
  ["4", "Thursday"],
  ["5", "Friday"],
  ["6", "Saturday"],
  ["0", "Sunday"],
] as const;

const ZONES = ["America/Los_Angeles", "America/Denver", "America/Phoenix", "America/Chicago", "America/New_York", "UTC"];

const BLANK: Omit<Policy, "id" | "customers"> = {
  name: "",
  timeZone: "America/Los_Angeles",
  hours: Object.fromEntries(["1", "2", "3", "4", "5"].map((d) => [d, [["08:00", "17:00"]]])),
  holidays: [],
  targets: {
    urgent: { firstResponse: 60, resolution: 480 },
    high: { firstResponse: 120, resolution: 1080 },
    normal: { firstResponse: 240, resolution: 2700 },
    low: { firstResponse: 480, resolution: 5400 },
  },
  warnPercent: 75,
};

/** Hours shown with up to two decimals; stored as whole minutes. */
const toHours = (m: number) => String(Math.round((m / 60) * 100) / 100);
const toMinutes = (h: string) => Math.round(Number(h) * 60);

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [ok, setOk] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    setFields({});
    setOk(null);
    try {
      await fn();
      setOk(success);
      start(() => router.refresh());
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      setFields(fieldErrors(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy: busy || pending, error, fields, ok };
}

function Status({ a }: { a: ReturnType<typeof useAction> }) {
  if (a.error)
    return (
      <div className="alert alert-danger" role="alert">
        <IconAlert />
        <div>
          {a.error}
          {Object.keys(a.fields).length > 0 && (
            <ul>
              {Object.entries(a.fields).map(([k, v]) => (
                <li key={k}>{v}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  if (a.ok)
    return (
      <p className="subtle" role="status">
        <IconCheck size={14} /> {a.ok}
      </p>
    );
  return null;
}

function PolicyEditor({ policy, onDone }: { policy: Policy | null; onDone: () => void }) {
  const a = useAction();
  const start = policy ?? { ...BLANK, id: "", customers: [] };
  const [name, setName] = useState(start.name);
  const [timeZone, setTz] = useState(start.timeZone);
  const [hours, setHours] = useState(start.hours);
  const [holidays, setHolidays] = useState(start.holidays.join("\n"));
  const [targets, setTargets] = useState(
    Object.fromEntries(PRIORITIES.map((p) => [p, { fr: toHours(start.targets[p].firstResponse), res: toHours(start.targets[p].resolution) }])) as Record<
      Priority,
      { fr: string; res: string }
    >,
  );
  const [warn, setWarn] = useState(String(start.warnPercent));
  const key = policy?.id ?? "new";

  const setDay = (d: string, open: boolean, s?: string, e?: string) =>
    setHours((h) => {
      const n = { ...h };
      if (!open) delete n[d];
      else n[d] = [[s ?? n[d]?.[0]?.[0] ?? "08:00", e ?? n[d]?.[0]?.[1] ?? "17:00"]];
      return n;
    });

  return (
    <form
      className="card stack"
      onSubmit={async (ev) => {
        ev.preventDefault();
        const body = {
          name,
          timeZone,
          hours,
          holidays: holidays.split(/[\s,]+/).filter(Boolean),
          targets: Object.fromEntries(PRIORITIES.map((p) => [p, { firstResponse: toMinutes(targets[p].fr), resolution: toMinutes(targets[p].res) }])),
          warnPercent: Number(warn),
        };
        const ok = await a.run(
          () => apiFetch(policy ? `/api/admin/sla-policies/${policy.id}` : "/api/admin/sla-policies", { method: policy ? "PUT" : "POST", body }),
          policy ? "Policy saved" : "Policy created",
        );
        if (ok && !policy) onDone();
      }}
    >
      <h2>{policy ? policy.name : "New policy"}</h2>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor={`name-${key}`}>Name</label>
          <input id={`name-${key}`} className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        </div>
        <div className="field">
          <label htmlFor={`tz-${key}`}>Time zone</label>
          <select id={`tz-${key}`} className="select" value={timeZone} onChange={(e) => setTz(e.target.value)}>
            {[...new Set([timeZone, ...ZONES])].map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="stack">
        <legend className="label">Business hours</legend>
        <div className="hours-grid">
          {DAYS.map(([d, label]) => {
            const span = hours[d]?.[0];
            return (
              <div key={d} className="hours-row">
                <label className="check">
                  <input type="checkbox" checked={Boolean(span)} onChange={(e) => setDay(d, e.target.checked)} /> {label}
                </label>
                {span ? (
                  <span className="row">
                    <input aria-label={`${label} opens`} type="time" className="input" value={span[0]} onChange={(e) => setDay(d, true, e.target.value, span[1])} />
                    <span className="subtle">to</span>
                    <input aria-label={`${label} closes`} type="time" className="input" value={span[1]} onChange={(e) => setDay(d, true, span[0], e.target.value)} />
                  </span>
                ) : (
                  <span className="subtle">Closed</span>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="stack">
        <legend className="label">Targets (business hours)</legend>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Priority</th>
              <th scope="col">First response</th>
              <th scope="col">Resolution</th>
            </tr>
          </thead>
          <tbody>
            {PRIORITIES.map((p) => (
              <tr key={p}>
                <th scope="row">{PRIORITY_LABEL[p]}</th>
                <td>
                  <input aria-label={`${PRIORITY_LABEL[p]} first response hours`} className="input" type="number" min="0.02" step="0.25" value={targets[p].fr} onChange={(e) => setTargets((t) => ({ ...t, [p]: { ...t[p], fr: e.target.value } }))} required />
                </td>
                <td>
                  <input aria-label={`${PRIORITY_LABEL[p]} resolution hours`} className="input" type="number" min="0.02" step="0.25" value={targets[p].res} onChange={(e) => setTargets((t) => ({ ...t, [p]: { ...t[p], res: e.target.value } }))} required />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>

      <div className="grid grid-2">
        <div className="field">
          <label htmlFor={`warn-${key}`}>Warn technicians at (% of target used)</label>
          <input id={`warn-${key}`} className="input" type="number" min={1} max={99} value={warn} onChange={(e) => setWarn(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor={`hol-${key}`}>Holidays (one date per line, YYYY-MM-DD)</label>
          <textarea id={`hol-${key}`} className="textarea" rows={3} value={holidays} onChange={(e) => setHolidays(e.target.value)} />
        </div>
      </div>
      <Status a={a} />
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={a.busy}>
          {a.busy && <span className="spinner" aria-hidden />}
          {policy ? "Save policy" : "Create policy"}
        </button>
        {!policy && (
          <button type="button" className="btn btn-ghost" onClick={onDone}>Cancel</button>
        )}
      </div>
    </form>
  );
}

function AssignRow({ customer, policies }: { customer: Customer; policies: Policy[] }) {
  const a = useAction();
  return (
    <tr>
      <th scope="row">{customer.name}</th>
      <td>
        <select
          aria-label={`Service level for ${customer.name}`}
          className="select"
          defaultValue={customer.policyId ?? ""}
          disabled={a.busy}
          onChange={(e) => a.run(() => apiFetch(`/api/admin/customers/${customer.id}/sla`, { method: "PUT", body: { policyId: e.target.value || null } }), "Saved")}
        >
          <option value="">No SLA</option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </td>
      <td><Status a={a} /></td>
    </tr>
  );
}

export function SlaConsole({ policies, customers }: { policies: Policy[]; customers: Customer[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="assign-h">
        <h2 id="assign-h">Customers</h2>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Service level</th>
              <th scope="col"><span className="sr-only">Result</span></th>
            </tr>
          </thead>
          <tbody>
            {customers
              .filter((c) => c.status !== "offboarded")
              .map((c) => (
                <AssignRow key={c.id} customer={c} policies={policies} />
              ))}
          </tbody>
        </table>
      </section>
      {policies.map((p) => (
        <PolicyEditor key={p.id} policy={p} onDone={() => undefined} />
      ))}
      {adding ? (
        <PolicyEditor policy={null} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className="btn" onClick={() => setAdding(true)}>Add a policy</button>
      )}
    </div>
  );
}
