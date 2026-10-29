"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert, IconCheck } from "@/components/icons";
import type { ReportEmailStatus } from "@/lib/reports/emails";

/** Emailing the report to the client's administrators, now or automatically each month. */
export function ReportEmailCard({ reportId, customerId, status, emailReady }: { reportId: string; customerId: string; status: ReportEmailStatus; emailReady: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      start(() => router.refresh());
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };
  const receiving = status.admins.filter((a) => !a.optedOut);
  return (
    <section className="card tight stack-tight no-print report-email-card" aria-labelledby="remail-h">
      <h2 id="remail-h" className="eyebrow">Email to the client</h2>
      <p className="subtle">
        {status.admins.length === 0
          ? "This client has no administrators yet, so there's nobody to send it to."
          : `Goes to the client's administrators: ${status.admins.map((a) => (a.optedOut ? `${a.name} (turned these off)` : a.name)).join(", ")}. A summary with a link to the full report; the details stay behind sign-in.`}
      </p>
      {!emailReady && <p className="subtle">Email isn&apos;t set up for the IT Center yet.</p>}
      <label className="check">
        <input
          type="checkbox"
          checked={status.automatic}
          disabled={busy || pending}
          onChange={(e) => {
            const enabled = e.target.checked;
            act(async () => {
              await apiFetch(`/api/admin/customers/${customerId}/report-emails`, { method: "PUT", body: { enabled } });
              return enabled ? "They'll get it automatically each month." : "Automatic emails are off for this client.";
            });
          }}
        />{" "}
        Send automatically when each month&apos;s report is ready
      </label>
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={busy || pending || !emailReady || receiving.length === 0}
          onClick={() =>
            act(async () => {
              const r = await apiFetch<{ queued: number }>(`/api/admin/reports/${reportId}/email`, { method: "POST" });
              return `Sending to ${r.queued} administrator${r.queued === 1 ? "" : "s"}.`;
            })
          }
        >
          Email this report now
        </button>
        {msg && (
          <span role="status" className={msg.ok ? "subtle" : "field-error"}>
            {msg.ok ? <IconCheck size={14} /> : <IconAlert size={14} />} {msg.text}
          </span>
        )}
      </div>
      {status.sent.length > 0 && (
        <p className="subtle">
          Sent: {status.sent.map((s) => `${s.name}, ${new Date(s.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`).join(" · ")}
        </p>
      )}
    </section>
  );
}
