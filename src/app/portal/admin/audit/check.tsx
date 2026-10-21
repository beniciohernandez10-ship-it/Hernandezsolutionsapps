"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert, IconCheck } from "@/components/icons";

interface Result {
  configured: boolean;
  shipped?: number;
  verification?: { ok: boolean; records: number; note: string | null } | null;
}

export function CheckNow() {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="stack">
      <div className="row">
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const r = await apiFetch<Result>("/api/admin/audit", { method: "POST" });
              const v = r.verification;
              setMsg(
                v?.ok
                  ? { ok: true, text: `Sent ${r.shipped ?? 0} waiting event(s). Chain checked: ${v.records} records, intact.` }
                  : { ok: false, text: v?.note ?? "The check didn't complete." },
              );
              start(() => router.refresh());
            } catch (e) {
              setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Something went wrong." });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <span className="spinner" aria-hidden />}
          Send and check now
        </button>
      </div>
      {msg && (
        <div className={`alert ${msg.ok ? "alert-success" : "alert-danger"}`} role={msg.ok ? "status" : "alert"}>
          {msg.ok ? <IconCheck /> : <IconAlert />}
          <div>{msg.text}</div>
        </div>
      )}
    </div>
  );
}
