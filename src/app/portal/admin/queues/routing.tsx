"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert, IconCheck } from "@/components/icons";
import type { HardwareSettings } from "@/lib/hardware/service";

/** Where hardware requests go once approved, and once they arrive. */
export function HardwareRouting({ settings, queues }: { settings: HardwareSettings; queues: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [order, setOrder] = useState(settings.orderQueueId ?? "");
  const [delivery, setDelivery] = useState(settings.deliveryQueueId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const pickQueue = (id: string, label: string, value: string, onChange: (v: string) => void, hint: string) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" value={value} onChange={(e) => { onChange(e.target.value); setSaved(false); }}>
        <option value="">Leave the queue as it is</option>
        {queues.map((q) => (
          <option key={q.id} value={q.id}>{q.name}</option>
        ))}
      </select>
      <span className="hint">{hint}</span>
    </div>
  );
  return (
    <form
      className="card tight stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await apiFetch("/api/admin/hardware", { method: "PUT", body: { orderQueueId: order || null, deliveryQueueId: delivery || null } });
          setSaved(true);
          start(() => router.refresh());
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Couldn't save.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="eyebrow">Hardware requests</h2>
      <div className="grid grid-2">
        {pickQueue("hw-order-q", "Once approved, send to", order, setOrder, "Whoever orders hardware works from this queue.")}
        {pickQueue("hw-delivery-q", "Once it arrives, send to", delivery, setDelivery, "Technicians who deliver and set it up work from this queue.")}
      </div>
      {error && (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>{error}</div>
        </div>
      )}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy || pending}>Save</button>
        {saved && (
          <span className="subtle" role="status">
            <IconCheck size={14} /> Saved
          </span>
        )}
      </div>
    </form>
  );
}
