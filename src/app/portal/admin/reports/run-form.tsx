"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert } from "@/components/icons";

export function RunReportForm({ customers, defaultMonth, maxMonth }: { customers: { id: string; name: string }[]; defaultMonth: string; maxMonth: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        try {
          const r = await apiFetch<{ id: string }>("/api/admin/reports", { method: "POST", body: { customerId: fd.get("customerId"), month: fd.get("month") } });
          router.push(`/portal/admin/reports/${r.id}`);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Something went wrong.");
          setBusy(false);
        }
      }}
    >
      <h2>Run a report</h2>
      <div className="form-grid two">
        <div className="field">
          <label htmlFor="rr-customer">Client</label>
          <select id="rr-customer" name="customerId" className="select" required defaultValue={customers[0]?.id}>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rr-month">Month</label>
          <input id="rr-month" name="month" type="month" className="input" required defaultValue={defaultMonth} max={maxMonth} />
        </div>
      </div>
      <p className="subtle">Running a month again replaces its saved report with fresh data. The current month gives a report so far.</p>
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={busy || customers.length === 0}>
          {busy && <span className="spinner" aria-hidden />}
          Run report
        </button>
      </div>
    </form>
  );
}
