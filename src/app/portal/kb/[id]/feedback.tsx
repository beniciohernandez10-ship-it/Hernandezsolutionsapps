"use client";
import Link from "next/link";
import { useState } from "react";
import { apiFetch } from "@/components/client-api";

export function Feedback({ id, initial }: { id: string; initial: boolean | null }) {
  const [vote, setVote] = useState<boolean | null>(initial);
  const [busy, setBusy] = useState(false);
  const send = async (helpful: boolean) => {
    setBusy(true);
    try {
      await apiFetch(`/api/kb/${id}/feedback`, { method: "POST", body: { helpful } });
      setVote(helpful);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card tight stack" aria-labelledby="fb-h">
      <h2 id="fb-h" className="label">Did this help?</h2>
      <div className="row" role="group" aria-labelledby="fb-h">
        <button type="button" className="btn" aria-pressed={vote === true} disabled={busy} onClick={() => send(true)}>Yes</button>
        <button type="button" className="btn" aria-pressed={vote === false} disabled={busy} onClick={() => send(false)}>No</button>
      </div>
      {vote === false && (
        <p>
          Sorry about that. <Link href="/portal/tickets/new">Open a request</Link> and we&apos;ll help.
        </p>
      )}
      {vote === true && <p className="subtle" role="status">Thanks for letting us know.</p>}
    </section>
  );
}
