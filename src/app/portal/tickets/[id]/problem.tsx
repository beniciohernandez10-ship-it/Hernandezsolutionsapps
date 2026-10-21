"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert } from "@/components/icons";

/** Technicians: the problem behind this request, or link it to an open one. */
export function ProblemCard({
  ticketId,
  problem,
  options,
}: {
  ticketId: string;
  problem: { id: string; number: number; title: string; status: string } | null;
  options: { id: string; number: number; title: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = async (problemId: string, remove = false) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/problems/${problemId}/tickets`, { method: "POST", body: { ticketId, remove } });
      start(() => router.refresh());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card tight stack" aria-labelledby="prob-h">
      <h2 id="prob-h" className="eyebrow">Problem · technicians only</h2>
      {problem ? (
        <p>
          <Link href={`/portal/problems/${problem.id}`}>PRB-{problem.number}: {problem.title}</Link>{" "}
          <button type="button" className="btn btn-ghost" disabled={busy || pending} onClick={() => link(problem.id, true)}>Unlink</button>
        </p>
      ) : (
        <div className="row">
          {options.length > 0 && (
            <>
              <label htmlFor="prob-pick" className="sr-only">Open problem</label>
              <select id="prob-pick" className="select" value={choice} onChange={(e) => setChoice(e.target.value)}>
                <option value="">Link to an open problem…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>PRB-{o.number}: {o.title}</option>
                ))}
              </select>
              <button type="button" className="btn" disabled={!choice || busy || pending} onClick={() => link(choice)}>Link</button>
            </>
          )}
          <Link className="btn btn-ghost" href="/portal/problems/new">Record a problem</Link>
        </div>
      )}
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
    </section>
  );
}
