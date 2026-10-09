"use client";
import { useState } from "react";
import { apiFetch, ApiError } from "@/components/client-api";

export function DemoSignIn({ personas }: { personas: { id: string; label: string; description: string }[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-labelledby="demo-h" className="card tight">
      <h2 id="demo-h" className="eyebrow">Local demo only · fictional people</h2>
      <p className="subtle">These personas exist only in local development. They are disabled in production and on any non-localhost address.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="persona-list">
        {personas.map((p) => (
          <button
            key={p.id}
            className="btn"
            disabled={busy !== null}
            onClick={async () => {
              setBusy(p.id);
              setError(null);
              try {
                const r = await apiFetch<{ redirect: string }>("/api/auth/demo", { method: "POST", body: { personaId: p.id } });
                window.location.assign(r.redirect);
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Demo sign-in failed.");
                setBusy(null);
              }
            }}
          >
            {busy === p.id ? "Signing in…" : p.label}
            <span>{p.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
