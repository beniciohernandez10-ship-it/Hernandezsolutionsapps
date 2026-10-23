"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert, IconCheck } from "@/components/icons";
import { ROLE_LABEL, type Role } from "@/lib/authz";

interface Customer {
  id: string;
  slug: string;
  name: string;
  status: string;
  is_demo: boolean;
  members: number;
  ai_enabled: boolean;
  directories: { tenantId: string; name: string; inventory: boolean; consentAt: string | null }[] | null;
  atera: { connection: string; ateraCustomerId: number; verifiedAt: string | null }[] | null;
}
interface Member {
  id: string;
  role: string;
  display_name: string;
  email: string;
  identities: number;
}



function useAction() {
  const router = useRouter();
  const [, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return {
    msg,
    busy,
    async run<T>(fn: () => Promise<T>, ok: (r: T) => string) {
      setBusy(true);
      setMsg(null);
      try {
        const r = await fn();
        setMsg({ ok: true, text: ok(r) });
        start(() => router.refresh());
      } catch (e) {
        setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Something went wrong." });
      } finally {
        setBusy(false);
      }
    },
  };
}

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return (
    <div className={`alert ${m.ok ? "alert-success" : "alert-danger"}`} role={m.ok ? "status" : "alert"}>
      {m.ok ? <IconCheck /> : <IconAlert />}
      <div className="prewrap">{m.text}</div>
    </div>
  );
}

export function AdminConsole({
  customers,
  memberships,
  connections,
  aiReady,
}: {
  customers: Customer[];
  memberships: Record<string, Member[]>;
  connections: { id: string; name: string }[];
  aiReady: boolean;
}) {
  const create = useAction();
  return (
    <div className="stack">
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          create.run(() => apiFetch("/api/admin/customers", { method: "POST", body: { name: fd.get("name"), slug: fd.get("slug") } }), () => "Customer created.");
        }}
      >
        <h2>Onboard a customer</h2>
        <div className="form-grid two">
          <div className="field">
            <label htmlFor="c-name">Organization name</label>
            <input id="c-name" name="name" className="input" required />
          </div>
          <div className="field">
            <label htmlFor="c-slug">Short ID</label>
            <input id="c-slug" name="slug" className="input" required pattern="[a-z0-9][a-z0-9-]{1,62}" placeholder="contoso-dental" />
          </div>
        </div>
        <button className="btn btn-primary" disabled={create.busy}>Create customer</button>
        <Msg m={create.msg} />
      </form>
      {customers.map((c) => (
        <CustomerCard key={c.id} c={c} members={memberships[c.id] ?? []} connections={connections} aiReady={aiReady} />
      ))}
    </div>
  );
}

function CustomerCard({ c, members, connections, aiReady }: { c: Customer; members: Member[]; connections: { id: string; name: string }[]; aiReady: boolean }) {
  const ai = useAction();
  const dir = useAction();
  const grant = useAction();
  const atera = useAction();
  const revoke = useAction();
  const status = useAction();
  return (
    <section className="card stack" aria-labelledby={`cust-${c.id}`}>
      <div className="spread">
        <h2 id={`cust-${c.id}`}>{c.name}</h2>
        <span className="badge">{c.status}{c.is_demo ? " · demo" : ""}</span>
      </div>
      <p className="subtle mono">Internal ID {c.id}</p>

      <h3>Microsoft Entra directories</h3>
      {(c.directories ?? []).length === 0 ? (
        <p className="subtle">None mapped.</p>
      ) : (
        <ul>
          {c.directories!.map((d) => (
            <li key={d.tenantId}>
              {d.name} <span className="mono subtle">{d.tenantId}</span> · inventory {d.inventory ? "enabled" : "off"} · consent{" "}
              {d.consentAt ? "recorded" : "not recorded"}
            </li>
          ))}
        </ul>
      )}
      <form
        className="form-grid two"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          dir.run(
            () => apiFetch(`/api/admin/customers/${c.id}/directories`, { method: "POST", body: { tenantId: fd.get("tenantId"), displayName: fd.get("displayName"), inventoryEnabled: fd.get("inventory") === "on" } }),
            () => "Directory mapped.",
          );
        }}
      >
        <div className="field">
          <label htmlFor={`tid-${c.id}`}>Directory (tenant) ID</label>
          <input id={`tid-${c.id}`} name="tenantId" className="input mono" required />
        </div>
        <div className="field">
          <label htmlFor={`dn-${c.id}`}>Directory name</label>
          <input id={`dn-${c.id}`} name="displayName" className="input" required />
        </div>
        <label className="row"><input type="checkbox" name="inventory" /> Enable Intune inventory (requires recorded admin consent)</label>
        <button className="btn" disabled={dir.busy}>Map directory</button>
        <Msg m={dir.msg} />
      </form>

      <h3>Atera</h3>
      {(c.atera ?? []).length === 0 ? (
        <p className="subtle">Not mapped.</p>
      ) : (
        <ul>
          {c.atera!.map((a) => (
            <li key={a.connection}>
              {a.connection}: customer {a.ateraCustomerId} · {a.verifiedAt ? "verified" : "awaiting verification"}
            </li>
          ))}
        </ul>
      )}
      {connections.length > 0 ? (
        <form
          className="form-grid two"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            atera.run(
              () => apiFetch(`/api/admin/customers/${c.id}/atera`, { method: "POST", body: { connectionId: fd.get("connectionId"), ateraCustomerId: fd.get("ateraCustomerId") } }),
              () => "Mapping saved. A read-only verification job was queued.",
            );
          }}
        >
          <div className="field">
            <label htmlFor={`conn-${c.id}`}>Atera account</label>
            <select id={`conn-${c.id}`} name="connectionId" className="select">
              {connections.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`aid-${c.id}`}>Atera customer ID</label>
            <input id={`aid-${c.id}`} name="ateraCustomerId" className="input" inputMode="numeric" required />
          </div>
          <button className="btn" disabled={atera.busy}>Map Atera customer</button>
          <Msg m={atera.msg} />
        </form>
      ) : (
        <p className="subtle">No Atera connections configured. See docs/atera-setup.md.</p>
      )}

      <h3>People ({members.length})</h3>
      {members.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Signed in before</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <th scope="row">{m.display_name}<br /><span className="subtle">{m.email}</span></th>
                  <td>{ROLE_LABEL[m.role as Role] ?? m.role}</td>
                  <td>{m.identities > 0 ? "Yes" : "Invitation pending"}</td>
                  <td>
                    <button
                      className="btn btn-ghost"
                      disabled={revoke.busy}
                      onClick={() => {
                        if (confirm(`Remove ${m.display_name}'s ${ROLE_LABEL[m.role as Role] ?? m.role} access to ${c.name}?`)) {
                          revoke.run(() => apiFetch(`/api/admin/memberships/${m.id}`, { method: "DELETE" }), () => "Access removed.");
                        }
                      }}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Msg m={revoke.msg} />
      <form
        className="form-grid two"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          grant.run(
            () =>
              apiFetch<{ invitation: { url: string; expiresAt: string } | null }>(`/api/admin/customers/${c.id}/memberships`, {
                method: "POST",
                body: { email: fd.get("email"), displayName: fd.get("displayName"), role: fd.get("role"), tenantId: fd.get("tenantId") },
              }),
            (r) =>
              r.invitation
                ? `Access granted. Send this one-time sign-in link privately (expires ${new Date(r.invitation.expiresAt).toLocaleDateString()}):\n${r.invitation.url}`
                : "Access granted.",
          );
        }}
      >
        <div className="field">
          <label htmlFor={`gn-${c.id}`}>Name</label>
          <input id={`gn-${c.id}`} name="displayName" className="input" required />
        </div>
        <div className="field">
          <label htmlFor={`ge-${c.id}`}>Email (for contact only)</label>
          <input id={`ge-${c.id}`} name="email" type="email" className="input" required />
        </div>
        <div className="field">
          <label htmlFor={`gr-${c.id}`}>Role</label>
          <select id={`gr-${c.id}`} name="role" className="select">
            {Object.entries(ROLE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`gt-${c.id}`}>Sign-in directory (tenant) ID</label>
          <input id={`gt-${c.id}`} name="tenantId" className="input mono" required />
        </div>
        <button className="btn btn-primary" disabled={grant.busy}>Grant access</button>
        <Msg m={grant.msg} />
      </form>

      <h3>AI assistant</h3>
      <p className="subtle">
        {c.ai_enabled ? "On." : "Off."} When on, technicians can draft replies and triage with Claude, and this organization&apos;s people can get steps from
        published help articles before submitting. Ticket text is sent to Anthropic only when someone uses one of these buttons; private notes and
        technician-only articles are never sent.
        {!aiReady && " The assistant has no API key yet (ANTHROPIC_API_KEY), so it stays hidden until one is added."}
      </p>
      <div className="row">
        <button
          className="btn"
          disabled={ai.busy}
          onClick={() => {
            if (c.ai_enabled || confirm(`Turn on the AI assistant for ${c.name}? Their ticket text will be sent to Anthropic when the assistant is used.`)) {
              ai.run(() => apiFetch(`/api/admin/customers/${c.id}/ai`, { method: "PUT", body: { enabled: !c.ai_enabled } }), () => `AI assistant turned ${c.ai_enabled ? "off" : "on"}.`);
            }
          }}
        >
          {c.ai_enabled ? "Turn off AI assistant" : "Turn on AI assistant"}
        </button>
      </div>
      <Msg m={ai.msg} />

      <div className="row">
        <span className="label">Lifecycle</span>
        {["active", "offboarding", "offboarded"].filter((s) => s !== c.status).map((s) => (
          <button
            key={s}
            className="btn"
            disabled={status.busy}
            onClick={() => {
              if (s !== "offboarded" || confirm(`Offboarding ${c.name} removes portal access for all of its people. Continue?`)) {
                status.run(() => apiFetch(`/api/admin/customers/${c.id}/status`, { method: "PATCH", body: { status: s } }), () => `Status set to ${s}.`);
              }
            }}
          >
            Mark {s}
          </button>
        ))}
      </div>
      <Msg m={status.msg} />
    </section>
  );
}
