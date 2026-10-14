"use client";
import { useState } from "react";
import { apiFetch } from "./client-api";

export function SignOutButton({ className = "btn btn-ghost" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          if ("caches" in window) for (const k of await caches.keys()) await caches.delete(k);
          const r = await apiFetch<{ redirect: string }>("/api/auth/signout", { method: "POST" });
          window.location.assign(r.redirect);
        } catch {
          window.location.assign("/signed-out");
        }
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
