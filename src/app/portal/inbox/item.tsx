"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/components/client-api";
import { Time } from "@/components/time";
import { IconAlert, IconPaperclip } from "@/components/icons";
import { CATEGORIES, CATEGORY_LABEL, PRIORITIES, PRIORITY_LABEL } from "@/lib/tickets/schemas";
import type { InboxItem } from "@/lib/email/inbound";

export function InboxItemCard({ item, customers }: { item: InboxItem; customers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ticketId: string; number: number } | null>(null);
  const first = item.suggestions[0];
  const [customerId, setCustomerId] = useState(first?.customerId ?? "");
  const [requesterUserId, setRequester] = useState(first?.userId ?? "");
  const [title, setTitle] = useState((item.subject ?? "").replace(/^\s*((re|fw|fwd):\s*)+/i, "").slice(0, 200) || "Email request");

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      start(() => router.refresh());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const id = item.id.slice(0, 8);
  return (
    <article className="card stack">
      <header className="spread">
        <div>
          <strong>{item.subject || "(no subject)"}</strong>
          <p className="subtle">
            From {item.fromName ? `${item.fromName} ` : ""}&lt;{item.fromAddress}&gt; · <Time iso={item.receivedAt} />
            {item.attachmentCount > 0 && (
              <>
                {" "}· <IconPaperclip size={13} /> {item.attachmentCount} file{item.attachmentCount === 1 ? "" : "s"}
              </>
            )}
          </p>
        </div>
      </header>
      {item.reason && <p className="badge internal">{item.reason}</p>}
      {/* Plain text only: React escapes it; email HTML is never rendered. */}
      <div className="body email-body">{item.bodyText || "(no text)"}</div>
      {done ? (
        <p className="alert alert-success" role="status">
          <span>
            Created <Link href={`/portal/tickets/${done.ticketId}`}>request #{done.number}</Link>.
          </span>
        </p>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            act(async () => {
              const r = await apiFetch<{ ticketId: string; number: number }>(`/api/inbox/${item.id}/convert`, {
                method: "POST",
                body: { customerId, requesterUserId, title, priority: fd.get("priority"), category: fd.get("category") },
              });
              setDone(r);
            });
          }}
        >
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor={`cust-${id}`}>Customer</label>
              <select id={`cust-${id}`} className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
                <option value="">Choose…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`req-${id}`}>Requester</label>
              <select id={`req-${id}`} className="select" value={requesterUserId} onChange={(e) => setRequester(e.target.value)} required>
                <option value="">Choose…</option>
                {item.suggestions
                  .filter((s) => !customerId || s.customerId === customerId)
                  .map((s) => (
                    <option key={`${s.userId}-${s.customerId}`} value={s.userId}>{s.name} ({s.customerName})</option>
                  ))}
              </select>
              {item.suggestions.length === 0 && (
                <p className="hint">Nobody in your customers uses this address. Add the person in Administration first, or discard.</p>
              )}
            </div>
            <div className="field">
              <label htmlFor={`title-${id}`}>Title</label>
              <input id={`title-${id}`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={200} required />
            </div>
            <div className="field">
              <label htmlFor={`pri-${id}`}>Priority</label>
              <select id={`pri-${id}`} name="priority" className="select" defaultValue="normal">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`cat-${id}`}>Category</label>
              <select id={`cat-${id}`} name="category" className="select" defaultValue="general">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                ))}
              </select>
            </div>
          </div>
          {error && (
            <div className="alert alert-danger" role="alert">
              <IconAlert />
              <div>{error}</div>
            </div>
          )}
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={busy || pending || !customerId || !requesterUserId}>
              Create request
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy || pending} onClick={() => act(() => apiFetch(`/api/inbox/${item.id}/discard`, { method: "POST" }))}>
              Discard
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
