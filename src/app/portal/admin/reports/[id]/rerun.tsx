"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";

/** Rebuilds this report with current data (replaces the saved copy). */
export function RerunButton({ customerId, month }: { customerId: string; month: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      disabled={busy}
      onClick={async () => {
        if (!confirm("Rebuild this report with today's data? The saved copy will be replaced.")) return;
        setBusy(true);
        try {
          const r = await apiFetch<{ id: string }>("/api/admin/reports", { method: "POST", body: { customerId, month } });
          router.replace(`/portal/admin/reports/${r.id}?rebuilt=1`);
          router.refresh();
        } catch (e) {
          alert(e instanceof ApiError ? e.message : "Something went wrong.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy && <span className="spinner" aria-hidden />}
      Rebuild
    </button>
  );
}
