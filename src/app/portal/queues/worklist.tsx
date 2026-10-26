"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { apiFetch, ApiError } from "@/components/client-api";
import { PriorityBadge, SlaBadge, StatusBadge } from "@/components/badges";
import { Time } from "@/components/time";
import { IconAlert, IconCheck, IconInbox } from "@/components/icons";
import type { BulkResult, QueueKey, QueueTicket } from "@/lib/queues/service";
import type { Priority } from "@/lib/tickets/schemas";

interface Props {
  items: QueueTicket[];
  staff: { id: string; name: string; customerIds: string[] }[];
  queues: { id: string; name: string }[];
  currentQueue: QueueKey;
  userId: string;
  showCustomer: boolean;
  emptyText: string;
}

type Action = { action: "take" } | { action: "unassign" } | { action: "assign"; assigneeUserId: string } | { action: "move"; queueId: string | null };

export function QueueWorklist({ items, staff, queues, currentQueue, userId, showCustomer, emptyText }: Props) {
  const router = useRouter();
  const [pending, startRefresh] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; lines: string[] } | null>(null);

  // Drop selections for requests that left this list after a refresh.
  useEffect(() => {
    setSelected((s) => {
      const ids = new Set(items.map((t) => t.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [items]);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 3500);
    return () => clearTimeout(t);
  }, [done]);

  if (items.length === 0) {
    return (
      <div className="empty">
        <IconInbox size={28} />
        <p>{emptyText}</p>
      </div>
    );
  }

  const chosen = items.filter((t) => selected.has(t.id));
  const allChosen = chosen.length === items.length;
  // Only people who support every selected request's client can take them all.
  const customers = new Set(chosen.map((t) => t.customerId));
  const eligible = staff.filter((s) => [...customers].every((c) => s.customerIds.includes(c)));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const run = async (a: Action) => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<BulkResult>("/api/queues/bulk", {
        method: "POST",
        body: { ...a, tickets: chosen.map((t) => ({ id: t.id, version: t.version })) },
      });
      const byId = new Map(items.map((t) => [t.id, t]));
      if (r.updated) setDone(`Updated ${r.updated} ${r.updated === 1 ? "request" : "requests"}.`);
      if (r.failed.length) {
        setError({
          message: `${r.failed.length} ${r.failed.length === 1 ? "request wasn't" : "requests weren't"} changed:`,
          lines: r.failed.map((f) => `#${byId.get(f.id)?.number ?? "?"}: ${f.message}`),
        });
        setSelected(new Set(r.failed.map((f) => f.id)));
      } else setSelected(new Set());
      startRefresh(() => router.refresh());
    } catch (e) {
      setError({ message: e instanceof ApiError ? e.message : "Couldn't update the requests.", lines: [] });
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || pending;

  return (
    <div className="stack">
      <div className="queue-toolbar" role="toolbar" aria-label="Selected requests">
        <label className="check">
          <input
            type="checkbox"
            aria-label="Select all requests"
            checked={allChosen}
            ref={(el) => {
              if (el) el.indeterminate = chosen.length > 0 && !allChosen;
            }}
            onChange={() => setSelected(allChosen ? new Set() : new Set(items.map((t) => t.id)))}
          />
          <span>{chosen.length ? `${chosen.length} selected` : `Select all ${items.length}`}</span>
        </label>
        {chosen.length > 0 && (
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => run({ action: "take" })}>
              Assign to me
            </button>
            <select
              className="select"
              aria-label="Assign to"
              value=""
              disabled={disabled || eligible.length === 0}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__none") run({ action: "unassign" });
                else if (v) run({ action: "assign", assigneeUserId: v });
              }}
            >
              <option value="">{eligible.length ? "Assign to…" : "No one supports all these clients"}</option>
              {eligible
                .filter((s) => s.id !== userId)
                .map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              <option value="__none">Unassign</option>
            </select>
            <select
              className="select"
              aria-label="Move to queue"
              value=""
              disabled={disabled}
              onChange={(e) => {
                const v = e.target.value;
                if (v) run({ action: "move", queueId: v === "__none" ? null : v });
              }}
            >
              <option value="">Move to…</option>
              {queues
                .filter((q) => q.id !== currentQueue)
                .map((q) => (
                  <option key={q.id} value={q.id}>{q.name}</option>
                ))}
              {currentQueue !== "none" && <option value="__none">No queue</option>}
            </select>
            <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>
            {error.message}
            {error.lines.length > 0 && (
              <ul className="queue-errors">
                {error.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <ul className="ticket-list" aria-busy={disabled}>
        {items.map((t) => (
          <li key={t.id} className="queue-item" data-selected={selected.has(t.id) || undefined}>
            <label className="queue-check">
              <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select #${t.number} ${t.title}`} />
            </label>
            <Link className="ticket-row" href={`/portal/tickets/${t.id}`} transitionTypes={["nav-forward"]}>
              <div>
                <div className="title">{t.title}</div>
                <div className="meta">
                  <span className="ticket-number">#{t.number}</span>
                  {showCustomer && <span>{t.customerName}</span>}
                  <span>Opened <Time iso={t.createdAt} /></span>
                  <span>{t.assigneeUserId === userId ? "Assigned to you" : t.assigneeName ? `Assigned to ${t.assigneeName}` : "Unassigned"}</span>
                  {currentQueue === "all" && <span>{t.queueName ?? "No queue"}</span>}
                </div>
              </div>
              <div className="row">
                {t.approvalStatus === "pending" && <span className="badge status-waiting">Awaiting approval</span>}
                {t.sla && <SlaBadge state={t.sla} />}
                <PriorityBadge priority={t.priority as Priority} />
                <StatusBadge status={t.status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {done && (
        <div className="toast" role="status">
          <IconCheck /> {done}
        </div>
      )}
    </div>
  );
}
