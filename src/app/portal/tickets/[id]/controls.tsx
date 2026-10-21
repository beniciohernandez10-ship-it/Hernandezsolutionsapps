"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, type Status } from "@/lib/tickets/schemas";
import { IconAlert, IconCheck, IconLock } from "@/components/icons";
import { fillPlaceholders } from "@/lib/productivity/placeholders";

function useMutation() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(success);
      startTransition(() => router.refresh());
      setTimeout(() => setDone(null), 3000);
      return true;
    } catch (e) {
      const conflict = e instanceof ApiError && e.body.code === "version_conflict";
      setError({ message: e instanceof ApiError ? e.message : "Something went wrong.", conflict });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy: busy || pending, error, done, refresh: () => startTransition(() => router.refresh()) };
}

function Feedback({ m }: { m: ReturnType<typeof useMutation> }) {
  return (
    <>
      {m.error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>
            {m.error.message}{" "}
            {m.error.conflict && (
              <button type="button" className="btn btn-ghost" onClick={m.refresh}>Load latest</button>
            )}
          </div>
        </div>
      )}
      {m.done && (
        <div className="toast" role="status">
          <IconCheck /> {m.done}
        </div>
      )}
    </>
  );
}

export function ReplyBox({
  ticketId,
  canInternal,
  resolved,
  closed = false,
  canned = [],
  fill,
}: {
  ticketId: string;
  canInternal: boolean;
  resolved: boolean;
  closed?: boolean;
  /** Staff: saved replies to insert. */
  canned?: { id: string; title: string; body: string }[];
  fill?: { requesterName: string; ticketNumber: number; technicianName: string };
}) {
  const m = useMutation();
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"public" | "internal">("public");
  const internal = visibility === "internal";
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim()) return;
        const ok = await m.run(
          () => apiFetch(`/api/tickets/${ticketId}/messages`, { method: "POST", body: { body, visibility } }),
          internal ? "Private note added" : resolved ? "Reply sent and request reopened" : "Reply sent",
        );
        if (ok) setBody("");
      }}
    >
      <div className="spread">
        <h2 className="label">{internal ? "Private note" : "Reply"}</h2>
        {canInternal && (
          <div className="tabs" role="group" aria-label="Message type">
            <button type="button" aria-pressed={!internal} onClick={() => setVisibility("public")}>Public reply</button>
            <button type="button" aria-pressed={internal} onClick={() => setVisibility("internal")}>
              <IconLock size={13} /> Private note
            </button>
          </div>
        )}
      </div>
      {internal && <p className="subtle">Only technicians assigned to this customer can see private notes. The customer is never shown this.</p>}
      {!canInternal && resolved && <p className="subtle">This request is resolved. Replying will reopen it.</p>}
      {canInternal && closed && <p className="subtle">This request is closed. Replies and notes won&apos;t reopen it.</p>}
      {canned.length > 0 && fill && (
        <div className="field">
          <div className="spread">
            <label htmlFor="canned">Insert a saved reply</label>
            <a className="subtle" href="/portal/replies">Manage</a>
          </div>
          <select
            id="canned"
            className="select"
            value=""
            onChange={(e) => {
              const c = canned.find((x) => x.id === e.target.value);
              if (c) setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n` : "") + fillPlaceholders(c.body, fill));
            }}
          >
            <option value="">Choose…</option>
            {canned.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>
      )}
      {canned.length === 0 && canInternal && (
        <a className="subtle" href="/portal/replies">Create saved replies</a>
      )}
      <label htmlFor="reply" className="sr-only">{internal ? "Private note" : "Reply"}</label>
      <textarea id="reply" className="textarea" value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} placeholder={internal ? "Visible to technicians only" : "Write a reply"} />
      <Feedback m={m} />
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={m.busy || !body.trim()}>
          {m.busy && <span className="spinner" aria-hidden />}
          {internal ? "Add private note" : "Send reply"}
        </button>
      </div>
    </form>
  );
}

export function StatusControls({ ticketId, version, status, options, staff }: { ticketId: string; version: number; status: Status; options: Status[]; staff: boolean }) {
  const m = useMutation();
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState("");
  const update = (next: Status, extra: Record<string, unknown> = {}) =>
    m.run(() => apiFetch(`/api/tickets/${ticketId}`, { method: "PATCH", body: { expectedVersion: version, status: next, ...extra } }), `Status changed to ${STATUS_LABEL[next]}`);

  const resolveForm = (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (staff && resolution.trim().length < 10) return;
        if (await update("resolved", resolution.trim() ? { resolution: resolution.trim() } : {})) {
          setResolving(false);
          setResolution("");
        }
      }}
    >
      <div className="field">
        <label htmlFor="resolution">{staff ? "Resolution details" : "Anything to add? (optional)"}</label>
        <span className="hint" id="resolution-hint">
          {staff ? "What fixed it. The requester sees this." : "For example, what fixed it for you."} The request closes automatically 5 days after it&apos;s resolved.
        </span>
        <textarea
          id="resolution"
          className="textarea"
          rows={3}
          maxLength={5000}
          required={staff}
          minLength={staff ? 10 : undefined}
          aria-describedby="resolution-hint"
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
        />
      </div>
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={m.busy || (staff && resolution.trim().length < 10)}>
          {staff ? "Resolve" : "Mark as fixed"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setResolving(false)}>Cancel</button>
      </div>
    </form>
  );

  if (!staff) {
    return (
      <section className="card tight stack">
        <h2 className="eyebrow">Actions</h2>
        {options.includes("resolved") && !resolving && (
          <button className="btn btn-block" disabled={m.busy} onClick={() => setResolving(true)}>My issue is fixed</button>
        )}
        {resolving && resolveForm}
        {options.includes("open") && status === "resolved" && (
          <button className="btn btn-block" disabled={m.busy} onClick={() => update("open")}>Reopen request</button>
        )}
        <Feedback m={m} />
      </section>
    );
  }
  return (
    <section className="card tight stack">
      <h2 className="eyebrow">Status</h2>
      {resolving ? (
        resolveForm
      ) : (
        <div className="row">
          {options.map((s) => (
            <button key={s} className={`btn${s === "resolved" ? " btn-primary" : ""}`} disabled={m.busy} onClick={() => (s === "resolved" ? setResolving(true) : update(s))}>
              {(status === "resolved" || status === "closed") && s === "open" ? "Reopen" : s === "resolved" ? "Resolve…" : `Mark ${STATUS_LABEL[s].toLowerCase()}`}
            </button>
          ))}
        </div>
      )}
      <Feedback m={m} />
    </section>
  );
}

export function StaffControls(props: {
  ticketId: string;
  version: number;
  assigneeUserId: string | null;
  queueId: string | null;
  priority: string;
  staff: { id: string; name: string; role: string }[];
  queues: { id: string; name: string }[];
}) {
  const m = useMutation();
  return (
    <form
      className="card tight stack"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const assignee = String(fd.get("assignee") ?? "");
        const queue = String(fd.get("queue") ?? "");
        m.run(
          () =>
            apiFetch(`/api/tickets/${props.ticketId}`, {
              method: "PATCH",
              body: {
                expectedVersion: props.version,
                assigneeUserId: assignee || null,
                queueId: queue || null,
                priority: String(fd.get("priority")),
              },
            }),
          "Ticket updated",
        );
      }}
    >
      <h2 className="eyebrow">Assignment</h2>
      <div className="field">
        <label htmlFor="assignee">Technician</label>
        <select id="assignee" name="assignee" className="select" defaultValue={props.assigneeUserId ?? ""}>
          <option value="">Unassigned</option>
          {props.staff.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="queue">Queue</label>
        <select id="queue" name="queue" className="select" defaultValue={props.queueId ?? ""}>
          <option value="">No queue</option>
          {props.queues.map((q) => (
            <option key={q.id} value={q.id}>{q.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="priority-sel">Priority</label>
        <select id="priority-sel" name="priority" className="select" defaultValue={props.priority}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
          ))}
        </select>
      </div>
      <button className="btn" type="submit" disabled={m.busy}>Save</button>
      <Feedback m={m} />
    </form>
  );
}

export function DeviceLinker({ ticketId, devices }: { ticketId: string; devices: { id: string; name: string }[] }) {
  const m = useMutation();
  const [deviceId, setDeviceId] = useState("");
  if (devices.length === 0) return null;
  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="link-device">Link a device</label>
        <select id="link-device" className="select" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
          <option value="">Choose a device…</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
      <button
        className="btn"
        disabled={!deviceId || m.busy}
        onClick={async () => {
          if (await m.run(() => apiFetch(`/api/tickets/${ticketId}/devices`, { method: "POST", body: { deviceId } }), "Device linked")) setDeviceId("");
        }}
      >
        Link device
      </button>
      <Feedback m={m} />
    </div>
  );
}
