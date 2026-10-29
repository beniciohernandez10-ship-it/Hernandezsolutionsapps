"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert, IconCheck } from "@/components/icons";
import { Time } from "@/components/time";
import type { MonitorSettings, Severity } from "@/lib/monitoring/service";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async <T,>(fn: () => Promise<T>, after?: (r: T) => void) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      after?.(r);
      start(() => router.refresh());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  return { act, busy: busy || pending, error };
}

const ErrorLine = ({ error }: { error: string | null }) =>
  error ? (
    <div className="alert alert-danger" role="alert">
      <IconAlert />
      <div>{error}</div>
    </div>
  ) : null;

type Row = MonitorSettings & { customerId: string; customerName: string };

function SettingsRow({ row }: { row: Row }) {
  const a = useAct();
  const [s, setS] = useState<MonitorSettings>(row);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof MonitorSettings>(k: K, v: MonitorSettings[K]) => {
    setS((x) => ({ ...x, [k]: v }));
    setSaved(false);
  };
  const id = row.customerId;
  return (
    <li className="card tight stack-tight">
      <strong>{row.customerName}</strong>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={s.intuneCompliance} onChange={(e) => set("intuneCompliance", e.target.checked)} /> Not compliant in Intune
        </label>
        <label className="check">
          <input type="checkbox" checked={s.licenseShortage} onChange={(e) => set("licenseShortage", e.target.checked)} /> No spare licenses
        </label>
      </div>
      <div className="row">
        <label className="check" htmlFor={`stale-${id}`}>
          Not checked in for
          <input id={`stale-${id}`} className="input monitor-days" type="number" min={0} max={365} value={s.staleDeviceDays} onChange={(e) => set("staleDeviceDays", Number(e.target.value))} />
          days
        </label>
        <label className="check" htmlFor={`warr-${id}`}>
          Warranty ends within
          <input id={`warr-${id}`} className="input monitor-days" type="number" min={0} max={365} value={s.warrantyDays} onChange={(e) => set("warrantyDays", Number(e.target.value))} />
          days
        </label>
        <button type="button" className="btn" disabled={a.busy} onClick={() => a.act(() => apiFetch(`/api/admin/monitoring/settings/${id}`, { method: "PUT", body: s }), () => setSaved(true))}>
          Save
        </button>
        {saved && (
          <span className="subtle" role="status">
            <IconCheck size={14} /> Saved
          </span>
        )}
      </div>
      <span className="hint">0 days turns that check off.</span>
      <ErrorLine error={a.error} />
    </li>
  );
}

export function CheckSettings({ settings }: { settings: Row[] }) {
  if (!settings.length) return <p className="muted">No active clients.</p>;
  return (
    <ul className="stack queue-admin-list">
      {settings.map((r) => (
        <SettingsRow key={r.customerId} row={r} />
      ))}
    </ul>
  );
}

interface Source {
  id: string;
  name: string;
  customerId: string | null;
  customerName: string | null;
  minSeverity: Severity;
  autoResolve: boolean;
  lastReceivedAt: string | null;
}

/** Shown once after creating or rotating: the address and token to paste into the tool. */
function Reveal({ origin, id, token }: { origin: string; id: string; token: string }) {
  const url = `${origin}/api/alerts/${id}`;
  const example = `curl -X POST ${url} \\\n  -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"id":"disk-c-PC01","title":"Disk C: almost full on PC01","severity":"warning","device":"PC01"}'`;
  return (
    <div className="alert alert-success stack-tight" role="status">
      <div>
        <strong>Copy the token now.</strong> It won&apos;t be shown again (you can rotate it to get a new one).
      </div>
      <div className="field">
        <label>Webhook address</label>
        <input className="input mono" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
      </div>
      <div className="field">
        <label>Token (send as Authorization: Bearer …)</label>
        <input className="input mono" readOnly value={token} onFocus={(e) => e.currentTarget.select()} />
      </div>
      <details>
        <summary>Example request</summary>
        <pre className="mono-text prewrap">{example}</pre>
      </details>
    </div>
  );
}

const SEVERITY_LABEL: Record<Severity, string> = { info: "Any alert", warning: "Warning or worse", critical: "Critical only" };

export function Sources({ sources, customers, origin }: { sources: Source[]; customers: { id: string; name: string }[]; origin: string }) {
  const a = useAct();
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [minSeverity, setMinSeverity] = useState<Severity>("warning");
  const [autoResolve, setAutoResolve] = useState(true);
  const [revealed, setRevealed] = useState<{ id: string; token: string } | null>(null);

  return (
    <div className="stack">
      {revealed && <Reveal origin={origin} id={revealed.id} token={revealed.token} />}
      {sources.length > 0 && (
        <ul className="stack queue-admin-list">
          {sources.map((s) => (
            <li key={s.id} className="card tight spread">
              <div>
                <strong>{s.name}</strong>
                <div className="subtle">
                  {s.customerName ?? "Several clients (by Atera customer ID)"} · tickets for {SEVERITY_LABEL[s.minSeverity].toLowerCase()}
                  {s.autoResolve ? " · resolves when cleared" : ""} · {s.lastReceivedAt ? <>last alert <Time iso={s.lastReceivedAt} /></> : "nothing received yet"}
                </div>
              </div>
              <div className="row">
                <button type="button" className="btn" disabled={a.busy} onClick={() => a.act(() => apiFetch<{ id: string; token: string }>(`/api/admin/monitoring/sources/${s.id}`, { method: "POST" }), setRevealed)}>
                  Rotate token
                </button>
                <button type="button" className="btn btn-ghost" disabled={a.busy} onClick={() => a.act(() => apiFetch(`/api/admin/monitoring/sources/${s.id}`, { method: "DELETE" }), () => setRevealed(null))}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="card tight stack"
        onSubmit={(e) => {
          e.preventDefault();
          a.act(
            () => apiFetch<{ id: string; token: string }>("/api/admin/monitoring/sources", { method: "POST", body: { name, customerId: customerId || null, minSeverity, autoResolve } }),
            (r) => {
              setRevealed(r);
              setName("");
            },
          );
        }}
      >
        <h3 className="label">Connect a tool</h3>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="src-name">Name</label>
            <input id="src-name" className="input" value={name} maxLength={120} required placeholder="e.g. Atera alerts, UptimeRobot" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="src-client">Client</label>
            <select id="src-client" className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              <option value="">Several clients (matched by Atera customer ID)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="src-sev">Open a request for</label>
            <select id="src-sev" className="select" value={minSeverity} onChange={(e) => setMinSeverity(e.target.value as Severity)}>
              <option value="info">Any alert</option>
              <option value="warning">Warning or worse</option>
              <option value="critical">Critical only</option>
            </select>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={autoResolve} onChange={(e) => setAutoResolve(e.target.checked)} /> Resolve the request when the tool says it cleared (if nobody has picked it
          up)
        </label>
        <div>
          <button type="submit" className="btn btn-primary" disabled={a.busy || !name.trim()}>
            Create address and token
          </button>
        </div>
        <ErrorLine error={a.error} />
      </form>
    </div>
  );
}
