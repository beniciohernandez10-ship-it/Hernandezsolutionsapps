"use client";
import { useState } from "react";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert, IconCheck } from "@/components/icons";

interface Prefs {
  emailEnabled: boolean;
  emailTicketUpdates: boolean;
  emailNewTickets: boolean;
  emailAssignments: boolean;
  emailSla: boolean;
  emailReports: boolean;
}

export function PreferencesForm({ initial, staff, clientAdmin = false }: { initial: Prefs; staff: boolean; clientAdmin?: boolean }) {
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const toggle = (k: keyof Prefs) => (e: React.ChangeEvent<HTMLInputElement>) => setP((x) => ({ ...x, [k]: e.target.checked }));
  const option = (k: keyof Prefs, label: string, hint: string) => (
    <label className="check option">
      <input type="checkbox" checked={p[k]} onChange={toggle(k)} disabled={k !== "emailEnabled" && !p.emailEnabled} />
      <span>
        <strong>{label}</strong>
        <span className="subtle">{hint}</span>
      </span>
    </label>
  );
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          await apiFetch("/api/notifications/preferences", { method: "PUT", body: p });
          setMsg({ ok: true, text: "Saved" });
        } catch (err) {
          setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Couldn't save." });
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset className="stack">
        <legend className="label">Send me email about</legend>
        {option("emailEnabled", "Email notifications", "Turn off to get updates only inside the IT Center.")}
        {option("emailTicketUpdates", "Updates on my requests", "Replies, status changes and new files.")}
        {staff && option("emailNewTickets", "New requests", "For customers you're assigned to, when nobody is assigned yet.")}
        {staff && option("emailAssignments", "Assignments", "When a ticket is assigned to you.")}
        {staff && option("emailSla", "Service-level alerts", "When a response or resolution target is close or missed.")}
        {clientAdmin && option("emailReports", "Monthly reports", "A summary of your organization's requests when each month's report is ready.")}
      </fieldset>
      <p className="subtle">Emails show the request number, title and what changed, never the message text. Open the request to read it.</p>
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy && <span className="spinner" aria-hidden />}Save
        </button>
        {msg && (
          <span role="status" className={msg.ok ? "subtle" : "field-error"}>
            {msg.ok ? <IconCheck size={14} /> : <IconAlert size={14} />} {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}
