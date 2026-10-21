"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert } from "@/components/icons";

export function DeclareForm({ customers }: { customers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("major");
  const [all, setAll] = useState(false);
  const [chosen, setChosen] = useState<string[]>(customers.length === 1 ? [customers[0].id] : []);
  const [message, setMessage] = useState("");
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
          const r = await apiFetch<{ id: string }>("/api/incidents", { method: "POST", body: { title, severity, allCustomers: all, customerIds: all ? [] : chosen, message } });
          router.push(`/portal/incidents/${r.id}`, { transitionTypes: ["nav-forward"] } as never);
        } catch (ex) {
          setError(ex instanceof ApiError ? ex.message : "Couldn't declare the incident.");
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="d-title">What&apos;s affected</label>
        <input id="d-title" className="input" value={title} maxLength={200} placeholder="For example: Email delivery delays" onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="d-sev">Severity</label>
        <select id="d-sev" className="select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="minor">Minor: some people inconvenienced</option>
          <option value="major">Major: many people can&apos;t work normally</option>
          <option value="critical">Critical: business stopped or security issue</option>
        </select>
      </div>
      <fieldset className="stack">
        <legend className="label">Affected clients</legend>
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All clients (for example, a Microsoft 365 outage)
        </label>
        {!all &&
          customers.map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={chosen.includes(c.id)} onChange={(e) => setChosen((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))} /> {c.name}
            </label>
          ))}
      </fieldset>
      <div className="field">
        <label htmlFor="d-msg">First update</label>
        <textarea id="d-msg" className="textarea" rows={3} maxLength={5000} value={message} placeholder="What people are seeing and what we're doing." onChange={(e) => setMessage(e.target.value)} required />
      </div>
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={busy || title.trim().length < 3 || !message.trim() || (!all && !chosen.length)}>Declare incident</button>
        <button className="btn btn-ghost" type="button" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
