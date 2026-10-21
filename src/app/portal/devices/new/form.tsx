"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError, fieldErrors } from "@/components/client-api";
import { HardwareFields, hardwareFrom } from "@/components/hardware-fields";
import { PrimaryUserPicker, type PrimaryUserRef } from "@/components/primary-user-picker";
import { IconAlert } from "@/components/icons";
import { ASSET_KINDS, KIND_LABEL, KIND_PREFIX } from "@/lib/assets/naming";

export function RegisterDeviceForm({ orgs }: { orgs: { id: string; name: string }[] }) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(orgs.length === 1 ? orgs[0].id : "");
  const [kind, setKind] = useState<(typeof ASSET_KINDS)[number]>("workstation");
  const [user, setUser] = useState<PrimaryUserRef>({ source: "none" });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!customerId) {
      setErrors({ customerId: "Choose an organization." });
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const r = await apiFetch<{ id: string; tag: string }>("/api/assets", {
        method: "POST",
        body: { customerId, kind, primaryUser: user, location: String(fd.get("location") ?? ""), notes: String(fd.get("notes") ?? ""), hardware: hardwareFrom(fd) },
      });
      router.push(`/portal/devices/${r.id}?created=1`, { transitionTypes: ["nav-forward"] } as never);
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={onSubmit} noValidate>
      {formError && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>
            <strong>The device wasn&apos;t registered</strong> {formError}
          </div>
        </div>
      )}
      {orgs.length > 1 && (
        <div className="field">
          <label htmlFor="customerId">Organization</label>
          <select id="customerId" className="select" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setUser({ source: "none" }); }} aria-invalid={Boolean(errors.customerId)}>
            <option value="">Choose…</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          {errors.customerId && <p className="field-error"><IconAlert size={16} /> {errors.customerId}</p>}
        </div>
      )}
      <fieldset className="field">
        <legend className="label">Type</legend>
        <div className="radio-cards">
          {ASSET_KINDS.map((k) => (
            <label key={k}>
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              <span>
                {KIND_LABEL[k]}
                <br />
                <span className="subtle">Named {KIND_PREFIX[k]}-001, {KIND_PREFIX[k]}-002, …</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {/* Re-mounted per organization so a person from one customer can't carry over to another. */}
      <PrimaryUserPicker key={customerId} customerId={customerId} onChange={setUser} />
      <div className="field">
        <label htmlFor="location">Location</label>
        <span className="hint" id="location-hint">Office, floor, room or desk. For example: Main office, Front desk.</span>
        <input id="location" name="location" className="input" maxLength={120} autoComplete="off" aria-describedby="location-hint" />
      </div>
      <div className="field">
        <HardwareFields />
      </div>
      <div className="field">
        <label htmlFor="notes">Notes (optional)</label>
        <textarea id="notes" name="notes" className="textarea" maxLength={1000} />
      </div>
      <p className="subtle">The next free name is assigned when you save. Names are never reused.</p>
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy && <span className="spinner" aria-hidden />} {busy ? "Registering…" : "Register and get name"}
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => router.back()} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
