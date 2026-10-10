"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { PrimaryUserPicker, type PrimaryUserRef } from "@/components/primary-user-picker";
import { IconAlert } from "@/components/icons";

interface Props {
  id: string;
  customerId: string;
  version: number;
  status: "active" | "retired";
  location: string;
  notes: string;
  primaryUser: { name: string; upn: string | null } | null;
}

export function AssetControls(p: Props) {
  const router = useRouter();
  const [user, setUser] = useState<PrimaryUserRef | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/api/assets/${p.id}`, { method: "PATCH", body: { version: p.version, ...body } });
      setMsg({ ok: true, text: done });
      setUser(undefined);
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    save(
      { location: String(fd.get("location") ?? ""), notes: String(fd.get("notes") ?? ""), ...(user ? { primaryUser: user } : {}) },
      "Saved.",
    );
  }

  return (
    <section className="card stack" aria-labelledby="edit-h">
      <h2 id="edit-h" className="eyebrow">Update</h2>
      <form className="stack" onSubmit={onSubmit} key={p.version}>
        <PrimaryUserPicker customerId={p.customerId} initial={p.primaryUser} onChange={setUser} />
        <div className="field">
          <label htmlFor="edit-location">Location</label>
          <input id="edit-location" name="location" className="input" maxLength={120} defaultValue={p.location} />
        </div>
        <div className="field">
          <label htmlFor="edit-notes">Notes</label>
          <textarea id="edit-notes" name="notes" className="textarea" maxLength={1000} defaultValue={p.notes} />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>Save changes</button>
      </form>
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() => save({ status: p.status === "active" ? "retired" : "active" }, p.status === "active" ? "Retired. The name stays reserved." : "Reactivated.")}
      >
        {p.status === "active" ? "Retire device" : "Reactivate device"}
      </button>
      {msg && (
        <p className={msg.ok ? "subtle" : "field-error"} role={msg.ok ? "status" : "alert"}>
          {!msg.ok && <IconAlert size={16} />} {msg.text}
        </p>
      )}
    </section>
  );
}
