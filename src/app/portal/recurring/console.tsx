"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert, IconCheck } from "@/components/icons";
import { CATEGORIES, CATEGORY_LABEL, PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, type Category, type Priority } from "@/lib/tickets/schemas";
import { describeSchedule, FREQUENCIES, occurrence, type Frequency } from "@/lib/recurring/schedule";
import type { RecurringOptions, RecurringRow } from "@/lib/recurring/service";

interface Draft {
  id: string | null;
  customerId: string;
  title: string;
  description: string;
  priority: Priority;
  category: Category;
  requesterUserId: string | null;
  assigneeUserId: string | null;
  queueId: string | null;
  tasks: string;
  frequency: Frequency;
  interval: number;
  startsOn: string;
  endsOn: string | null;
  skipIfOpen: boolean;
  active: boolean;
}

const FREQ_LABEL: Record<Frequency, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };
const UNIT: Record<Frequency, string> = { daily: "days", weekly: "weeks", monthly: "months", quarterly: "quarters", yearly: "years" };

const toDraft = (r: RecurringRow): Draft => ({ ...r, tasks: r.tasks.join("\n") });

function blank(customerId: string, today: string): Draft {
  return {
    id: null, customerId, title: "", description: "", priority: "normal", category: "general", requesterUserId: null, assigneeUserId: null,
    queueId: null, tasks: "", frequency: "monthly", interval: 1, startsOn: today, endsOn: null, skipIfOpen: true, active: true,
  };
}

function Editor({ initial, options, today, onDone }: { initial: Draft; options: RecurringOptions; today: string; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const k = d.id ?? "new";
  const customer = options.customers.find((c) => c.id === d.customerId);
  const members = customer?.members ?? [];
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(d.startsOn);
  // Preview the next few dates the way the server counts them.
  const upcoming: string[] = [];
  if (validDate) {
    for (let n = 0; upcoming.length < 3 && n < 2000; n++) {
      const day = occurrence(d.startsOn, d.frequency, d.interval, n);
      if (d.endsOn && day > d.endsOn) break;
      if (day >= today) upcoming.push(day);
    }
  }
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      start(() => router.refresh());
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const { id, tasks, ...body } = d;
        act(() =>
          apiFetch(id ? `/api/recurring/${id}` : "/api/recurring", {
            method: id ? "PUT" : "POST",
            body: { ...body, tasks: tasks.split("\n").map((t) => t.trim()).filter(Boolean), endsOn: body.endsOn || null },
          }),
        );
      }}
    >
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor={`rt-title-${k}`}>Title</label>
          <input id={`rt-title-${k}`} className="input" value={d.title} maxLength={200} required placeholder="Monthly patch review – {month}" onChange={(e) => set("title", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`rt-client-${k}`}>Client</label>
          <select
            id={`rt-client-${k}`}
            className="select"
            value={d.customerId}
            disabled={Boolean(d.id)}
            onChange={(e) => setD((x) => ({ ...x, customerId: e.target.value, requesterUserId: null, assigneeUserId: null }))}
          >
            {options.customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`rt-desc-${k}`}>Description</label>
        <textarea id={`rt-desc-${k}`} className="textarea" rows={3} maxLength={20000} value={d.description} onChange={(e) => set("description", e.target.value)} />
        <span className="hint">
          Title, description and checklist can use {"{date}"}, {"{month}"}, {"{quarter}"} and {"{year}"}, filled in with each date.
        </span>
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor={`rt-freq-${k}`}>Repeats</label>
          <div className="row">
            <select id={`rt-freq-${k}`} className="select" value={d.frequency} onChange={(e) => set("frequency", e.target.value as Frequency)}>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>{FREQ_LABEL[f]}</option>
              ))}
            </select>
            <label className="check" htmlFor={`rt-int-${k}`}>
              every
              <input id={`rt-int-${k}`} className="input monitor-days" type="number" min={1} max={12} value={d.interval} onChange={(e) => set("interval", Math.max(1, Number(e.target.value) || 1))} />
              {d.interval === 1 ? UNIT[d.frequency].slice(0, -1) : UNIT[d.frequency]}
            </label>
          </div>
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor={`rt-start-${k}`}>Starting</label>
            <input id={`rt-start-${k}`} className="input" type="date" required value={d.startsOn} onChange={(e) => set("startsOn", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`rt-end-${k}`}>Ending (optional)</label>
            <input id={`rt-end-${k}`} className="input" type="date" min={d.startsOn} value={d.endsOn ?? ""} onChange={(e) => set("endsOn", e.target.value || null)} />
          </div>
        </div>
      </div>
      {validDate && (
        <p className="subtle" role="status">
          {describeSchedule(d.startsOn, d.frequency, d.interval)}. {upcoming.length ? <>Next: {upcoming.join(", ")}.</> : "No more dates before it ends."}
        </p>
      )}
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor={`rt-pri-${k}`}>Priority</label>
          <select id={`rt-pri-${k}`} className="select" value={d.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`rt-cat-${k}`}>Category</label>
          <select id={`rt-cat-${k}`} className="select" value={d.category} onChange={(e) => set("category", e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`rt-req-${k}`}>Requester</label>
          <select id={`rt-req-${k}`} className="select" value={d.requesterUserId ?? ""} onChange={(e) => set("requesterUserId", e.target.value || null)}>
            <option value="">IT Center Scheduler</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`rt-asg-${k}`}>Assign to</label>
          <select id={`rt-asg-${k}`} className="select" value={d.assigneeUserId ?? ""} onChange={(e) => set("assigneeUserId", e.target.value || null)}>
            <option value="">Nobody (assignment rules decide)</option>
            {members.filter((m) => m.staff).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`rt-q-${k}`}>Queue</label>
          <select id={`rt-q-${k}`} className="select" value={d.queueId ?? ""} onChange={(e) => set("queueId", e.target.value || null)}>
            <option value="">No queue</option>
            {options.queues.map((q) => (
              <option key={q.id} value={q.id}>{q.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`rt-tasks-${k}`}>Checklist (one item per line)</label>
          <textarea id={`rt-tasks-${k}`} className="textarea" rows={3} value={d.tasks} onChange={(e) => set("tasks", e.target.value)} />
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={d.skipIfOpen} onChange={(e) => set("skipIfOpen", e.target.checked)} /> Skip a date if the last request is still open
      </label>
      <label className="check">
        <input type="checkbox" checked={d.active} onChange={(e) => set("active", e.target.checked)} /> Active
      </label>
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={busy || pending || d.title.trim().length < 3 || !validDate}>Save</button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>Cancel</button>
        {d.id && (
          <button type="button" className="btn btn-ghost" disabled={busy || pending} onClick={() => act(() => apiFetch(`/api/recurring/${d.id}`, { method: "DELETE" }))}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

function RunNow({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; number: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={busy || pending}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setDone(await apiFetch<{ id: string; number: number }>(`/api/recurring/${id}/run`, { method: "POST" }));
            start(() => router.refresh());
          } catch (e) {
            setError(e instanceof ApiError ? e.message : "Couldn't open the request.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Open one now
      </button>
      {done && (
        <span className="subtle" role="status">
          <IconCheck size={14} /> Opened <Link href={`/portal/tickets/${done.id}`}>#{done.number}</Link>
        </span>
      )}
      {error && <span className="field-error" role="alert">{error}</span>}
    </>
  );
}

export function RecurringConsole({ rows, options, today }: { rows: RecurringRow[]; options: RecurringOptions; today: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const canCreate = options.customers.length > 0;
  return (
    <div className="stack">
      {rows.length === 0 && open !== "new" && <p className="muted">No recurring requests yet.</p>}
      <ul className="stack queue-admin-list" role="list">
        {rows.map((r) => (
          <li key={r.id} className="card tight stack-tight">
            {open === r.id ? (
              <Editor initial={toDraft(r)} options={options} today={today} onDone={() => setOpen(null)} />
            ) : (
              <>
                <div className="spread">
                  <div>
                    <strong>{r.title}</strong> {!r.active && <span className="badge status-waiting">Paused</span>}
                    <div className="subtle">
                      {r.customerName} · {r.schedule}
                      {r.endsOn ? ` until ${r.endsOn}` : ""} · {PRIORITY_LABEL[r.priority]} · {CATEGORY_LABEL[r.category]}
                    </div>
                    <div className="subtle">
                      {r.assigneeName ? `To ${r.assigneeName}` : "Unassigned"}
                      {r.queueName ? ` in ${r.queueName}` : ""}
                      {r.tasks.length ? ` · ${r.tasks.length} checklist item${r.tasks.length === 1 ? "" : "s"}` : ""}
                      {r.requesterName ? ` · requested by ${r.requesterName}` : ""}
                    </div>
                  </div>
                  {r.canManage && (
                    <div className="row">
                      <RunNow id={r.id} />
                      <button type="button" className="btn" onClick={() => setOpen(r.id)}>Edit</button>
                    </div>
                  )}
                </div>
                <div className="subtle">
                  {r.nextRunOn ? <>Next request <strong>{r.nextRunOn}</strong></> : r.active ? "No more dates" : "Paused"}
                  {r.lastRunOn && (
                    <>
                      {" "}· last {r.lastOutcome === "skipped_open" ? "skipped (previous still open)" : "opened"} {r.lastRunOn}
                      {r.lastTicket && (
                        <>
                          {": "}
                          <Link href={`/portal/tickets/${r.lastTicket.id}`}>#{r.lastTicket.number}</Link> ({STATUS_LABEL[r.lastTicket.status]?.toLowerCase() ?? r.lastTicket.status})
                        </>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {canCreate &&
        (open === "new" ? (
          <div className="card stack">
            <h2>New recurring request</h2>
            <Editor initial={blank(options.customers[0].id, today)} options={options} today={today} onDone={() => setOpen(null)} />
          </div>
        ) : (
          <div>
            <button type="button" className="btn btn-primary" onClick={() => setOpen("new")}>Add a recurring request</button>
          </div>
        ))}
    </div>
  );
}
