"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert } from "@/components/icons";
import { STATUS_LABEL } from "@/lib/tickets/schemas";
import type { RelatedTickets } from "@/lib/productivity/service";

export function RelatedCard({ ticketId, related, staff, mergeable }: { ticketId: string; related: RelatedTickets; staff: boolean; mergeable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parentNo, setParentNo] = useState("");
  const [mergeNo, setMergeNo] = useState("");
  const [confirmMerge, setConfirmMerge] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      start(() => router.refresh());
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const hasLinks = related.parent || related.children.length > 0 || related.mergedInto;
  if (!staff && !hasLinks) return null;
  const disabled = busy || pending;
  return (
    <section className="card tight stack" aria-labelledby="related-h">
      <h2 id="related-h" className="eyebrow">Related requests</h2>
      {related.mergedInto && (
        <p>
          Merged into{" "}
          <Link href={`/portal/tickets/${related.mergedInto.id}`}>
            #{related.mergedInto.number} {related.mergedInto.title}
          </Link>
        </p>
      )}
      {related.parent && (
        <p>
          Part of{" "}
          <Link href={`/portal/tickets/${related.parent.id}`}>
            #{related.parent.number} {related.parent.title}
          </Link>{" "}
          <span className="subtle">({STATUS_LABEL[related.parent.status]})</span>
          {staff && (
            <>
              {" "}
              <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => run(() => apiFetch(`/api/tickets/${ticketId}/parent`, { method: "PUT", body: { number: null } }))}>
                Unlink
              </button>
            </>
          )}
        </p>
      )}
      {related.children.length > 0 && (
        <div>
          <p className="subtle">Linked requests</p>
          <ul className="stack" role="list">
            {related.children.map((c) => (
              <li key={c.id}>
                <Link href={`/portal/tickets/${c.id}`}>#{c.number} {c.title}</Link> <span className="subtle">({STATUS_LABEL[c.status]})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {staff && !related.parent && (
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => apiFetch(`/api/tickets/${ticketId}/parent`, { method: "PUT", body: { number: Number(parentNo) } }))) setParentNo("");
          }}
        >
          <label htmlFor="parent-no" className="sr-only">Parent request number</label>
          <input id="parent-no" className="input input-number" inputMode="numeric" placeholder="Parent #" value={parentNo} onChange={(e) => setParentNo(e.target.value.replace(/\D/g, ""))} />
          <button className="btn" type="submit" disabled={disabled || !parentNo}>Link to parent</button>
        </form>
      )}
      {staff && mergeable && (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!confirmMerge) return setConfirmMerge(true);
            if (await run(() => apiFetch(`/api/tickets/${ticketId}/merge`, { method: "POST", body: { number: Number(mergeNo) } }))) {
              setMergeNo("");
              setConfirmMerge(false);
            }
          }}
        >
          <div className="row">
            <label htmlFor="merge-no" className="sr-only">Merge into request number</label>
            <input id="merge-no" className="input input-number" inputMode="numeric" placeholder="Merge into #" value={mergeNo} onChange={(e) => { setMergeNo(e.target.value.replace(/\D/g, "")); setConfirmMerge(false); }} />
            <button className="btn" type="submit" disabled={disabled || !mergeNo}>{confirmMerge ? `Confirm merge into #${mergeNo}` : "Merge duplicate"}</button>
          </div>
          {confirmMerge && <p className="subtle">This request will be resolved as a duplicate of #{mergeNo}, and its details copied there as a private note. The requester is told.</p>}
        </form>
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
