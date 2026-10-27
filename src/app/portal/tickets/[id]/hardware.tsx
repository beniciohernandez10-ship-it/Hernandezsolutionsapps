"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/components/client-api";
import { IconAlert, IconCheck, IconPlus, IconX } from "@/components/icons";
import { Time } from "@/components/time";
import { ASSET_KINDS, KIND_LABEL, isComputer, type AssetKind } from "@/lib/assets/naming";
import type { HardwareOrderView, HardwareStage } from "@/lib/hardware/read";

const STEPS: { stage: HardwareStage; label: string }[] = [
  { stage: "approval", label: "Approval" },
  { stage: "ordering", label: "Ordering" },
  { stage: "ordered", label: "Ordered" },
  { stage: "received", label: "Arrived" },
  { stage: "delivered", label: "Delivered" },
];

function day(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function useStep(ticketId: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(body: object) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/tickets/${ticketId}/hardware`, { method: "POST", body });
      start(() => router.refresh());
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { send, busy: busy || pending, error };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <div className="alert alert-danger" role="alert">
      <IconAlert />
      <div>{error}</div>
    </div>
  ) : null;
}

// ---------------------------------------------------------------- barcode scanning

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (opts: { formats: string[] }) => Detector;
const detectorCtor = () => (typeof window !== "undefined" ? (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector : undefined);

/**
 * Reads a barcode with the device camera where the browser can (Chrome and
 * Edge, including Android). Elsewhere the serial is typed, scanned with a USB
 * barcode scanner (which types and presses Enter), or read with the iPhone
 * keyboard's Scan Text.
 */
function CameraScanner({ onResult, onClose }: { onResult: (value: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // The latest callback, without restarting the camera when the parent re-renders.
  const report = useRef(onResult);
  useEffect(() => {
    report.current = onResult;
  }, [onResult]);
  useEffect(() => {
    const Ctor = detectorCtor();
    if (!Ctor) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const detector = new Ctor({ formats: ["code_128", "code_39", "code_93", "ean_13", "upc_a", "itf", "qr_code", "data_matrix"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const found = await detector.detect(video.current);
            const value = found.map((f) => f.rawValue.trim()).find((v) => v.length >= 2 && v.length <= 80);
            if (value) {
              report.current(value);
              return;
            }
          } catch {
            // A frame that can't be read yet; keep looking.
          }
          timer = window.setTimeout(tick, 250);
        };
        tick();
      } catch {
        setError("The camera isn't available. Allow camera access, or type the serial number.");
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return (
    <div className="hw-scanner stack-tight">
      {error ? <p className="subtle">{error}</p> : <video ref={video} className="hw-scanner-video" muted playsInline aria-label="Camera preview" />}
      <div className="row">
        <span className="subtle">Point the camera at the serial number barcode.</span>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- forms

type Item = { key: number; kind: AssetKind; serialNumber: string; manufacturer: string; model: string };

function kindFromRequest(requested: string | null): AssetKind {
  const v = (requested ?? "").toLowerCase();
  if (v.includes("laptop")) return "laptop";
  if (v.includes("desktop") || v.includes("computer") || v.includes("workstation")) return "workstation";
  if (v.includes("monitor")) return "monitor";
  if (v.includes("dock")) return "dock";
  if (v.includes("phone")) return "phone";
  if (v.includes("tablet")) return "tablet";
  if (v.includes("printer")) return "printer";
  if (v.includes("headset") || v.includes("keyboard") || v.includes("mouse")) return "accessory";
  return "other";
}

function ReceiveForm({ ticketId, requested, onCancel }: { ticketId: string; requested: string | null; onCancel?: () => void }) {
  const s = useStep(ticketId);
  const next = useRef(1);
  const [items, setItems] = useState<Item[]>([{ key: 0, kind: kindFromRequest(requested), serialNumber: "", manufacturer: "", model: "" }]);
  const [method, setMethod] = useState<"tech_setup" | "user_setup">("tech_setup");
  const [scanning, setScanning] = useState<number | null>(null);
  const canScan = Boolean(detectorCtor());
  const computer = items.some((i) => isComputer(i.kind));
  const set = (key: number, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const effectiveMethod = computer ? "tech_setup" : method;

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        s.send({
          action: "received",
          deliveryMethod: effectiveMethod,
          items: items.map(({ kind, serialNumber, manufacturer, model }) => ({ kind, serialNumber, manufacturer, model })),
        });
      }}
    >
      <p className="subtle">Scan or type each item&apos;s serial number. Each one is registered as an asset for the requester, with its own tag.</p>
      {items.map((item, n) => (
        <fieldset key={item.key} className="hw-item stack-tight">
          <legend className="label">Item {n + 1}</legend>
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor={`kind-${item.key}`}>Type</label>
              <select id={`kind-${item.key}`} className="select" value={item.kind} onChange={(e) => set(item.key, { kind: e.target.value as AssetKind })}>
                {ASSET_KINDS.map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`serial-${item.key}`}>Serial number</label>
              <div className="row hw-serial">
                <input
                  id={`serial-${item.key}`}
                  className="input mono"
                  value={item.serialNumber}
                  required
                  maxLength={80}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  onChange={(e) => set(item.key, { serialNumber: e.target.value })}
                  onKeyDown={(e) => {
                    // USB scanners type the serial then press Enter: move on instead of submitting.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      document.getElementById(`make-${item.key}`)?.focus();
                    }
                  }}
                />
                {canScan && (
                  <button type="button" className="btn" onClick={() => setScanning(item.key)}>
                    Scan
                  </button>
                )}
              </div>
            </div>
            <div className="field">
              <label htmlFor={`make-${item.key}`}>Manufacturer</label>
              <input id={`make-${item.key}`} className="input" value={item.manufacturer} maxLength={80} placeholder="e.g. Dell" onChange={(e) => set(item.key, { manufacturer: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`model-${item.key}`}>Model</label>
              <input id={`model-${item.key}`} className="input" value={item.model} maxLength={120} placeholder="e.g. Latitude 7450" onChange={(e) => set(item.key, { model: e.target.value })} />
            </div>
          </div>
          {scanning === item.key && (
            <CameraScanner
              onClose={() => setScanning(null)}
              onResult={(value) => {
                set(item.key, { serialNumber: value });
                setScanning(null);
              }}
            />
          )}
          {items.length > 1 && (
            <button type="button" className="btn btn-ghost hw-remove" onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}>
              <IconX size={14} /> Remove item
            </button>
          )}
        </fieldset>
      ))}
      <div>
        <button
          type="button"
          className="btn"
          disabled={items.length >= 20}
          onClick={() => setItems((list) => [...list, { key: next.current++, kind: list[list.length - 1]?.kind ?? "other", serialNumber: "", manufacturer: "", model: "" }])}
        >
          <IconPlus size={14} /> Add another item
        </button>
      </div>
      {!canScan && <p className="subtle">Tip: a USB barcode scanner works here, and on an iPhone you can use the keyboard&apos;s Scan Text.</p>}
      <fieldset className="field">
        <legend className="label">Delivery</legend>
        <label className="check option">
          <input type="radio" name="method" checked={effectiveMethod === "tech_setup"} onChange={() => setMethod("tech_setup")} />
          <span>
            A technician delivers and sets it up
            {computer && <span className="subtle">Computers are always set up by a technician.</span>}
          </span>
        </label>
        <label className="check option">
          <input type="radio" name="method" disabled={computer} checked={effectiveMethod === "user_setup"} onChange={() => setMethod("user_setup")} />
          <span>Deliver it for the user to set up</span>
        </label>
      </fieldset>
      <ErrorLine error={s.error} />
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={s.busy}>
          {s.busy && <span className="spinner" aria-hidden />}
          Receive and register
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function OrderForm({ ticketId, initial, onDone, submitLabel }: { ticketId: string; initial: HardwareOrderView; onDone?: () => void; submitLabel: string }) {
  const s = useStep(ticketId);
  const [vendor, setVendor] = useState(initial.vendor ?? "");
  const [orderRef, setOrderRef] = useState(initial.orderRef ?? "");
  const [expectedOn, setExpectedOn] = useState(initial.expectedOn ?? "");
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await s.send({ action: "ordered", vendor, orderRef, expectedOn })) onDone?.();
      }}
    >
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="hw-vendor">Ordered from</label>
          <input id="hw-vendor" className="input" value={vendor} maxLength={120} placeholder="e.g. CDW, Amazon Business" onChange={(e) => setVendor(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="hw-ref">Order number</label>
          <input id="hw-ref" className="input" value={orderRef} maxLength={120} onChange={(e) => setOrderRef(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="hw-eta">Expected delivery</label>
          <input id="hw-eta" className="input" type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} />
        </div>
      </div>
      <p className="subtle">The requester sees the expected date, not the supplier or order number.</p>
      <ErrorLine error={s.error} />
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={s.busy}>
          {s.busy && <span className="spinner" aria-hidden />}
          {submitLabel}
        </button>
        {onDone && initial.stage === "ordered" && (
          <button type="button" className="btn btn-ghost" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function DeliverForm({ ticketId, method }: { ticketId: string; method: HardwareOrderView["deliveryMethod"] }) {
  const s = useStep(ticketId);
  const [note, setNote] = useState("");
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        s.send({ action: "delivered", note });
      }}
    >
      <div className="field">
        <label htmlFor="hw-note">Notes (optional)</label>
        <textarea id="hw-note" className="textarea" rows={2} maxLength={1000} value={note} placeholder="e.g. Moved files from the old laptop" onChange={(e) => setNote(e.target.value)} />
      </div>
      <ErrorLine error={s.error} />
      <div>
        <button type="submit" className="btn btn-primary" disabled={s.busy}>
          {s.busy && <span className="spinner" aria-hidden />}
          {method === "tech_setup" ? "Delivered and set up" : "Delivered"}: resolve the request
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- card

export function HardwareCard({ ticketId, hardware: h, requested }: { ticketId: string; hardware: HardwareOrderView; requested: string | null }) {
  const [editing, setEditing] = useState(false);
  const [receivingEarly, setReceivingEarly] = useState(false);
  const current = STEPS.findIndex((s) => s.stage === h.stage);
  const assetIds = h.items.map((i) => i.assetId).filter((x): x is string => Boolean(x));

  return (
    <section className="card tight stack" aria-labelledby="hw-h">
      <h2 id="hw-h" className="eyebrow">Hardware order</h2>
      {h.stage === "cancelled" ? (
        <p>
          <IconAlert size={14} /> <strong>Cancelled:</strong> the request wasn&apos;t approved, so nothing was ordered.
        </p>
      ) : (
        <ol className="hw-steps" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s.stage} data-state={i < current || h.stage === "delivered" ? "done" : i === current ? "current" : "todo"} aria-current={i === current ? "step" : undefined}>
              {s.label}
            </li>
          ))}
        </ol>
      )}

      {h.stage === "approval" && <p className="subtle">Nothing is ordered until the request is approved.</p>}
      {h.stage === "ordering" && !h.canAct && <p>Approved. It&apos;s being ordered.</p>}
      {(h.stage === "ordered" || h.orderedAt) && (
        <dl className="kv">
          {h.orderedAt && (
            <div className="kv-row">
              <dt>Ordered</dt>
              <dd>
                <Time iso={h.orderedAt} />
                {h.orderedByName && <> by {h.orderedByName}</>}
              </dd>
            </div>
          )}
          {h.vendor && (
            <div className="kv-row">
              <dt>From</dt>
              <dd>{h.vendor}</dd>
            </div>
          )}
          {h.orderRef && (
            <div className="kv-row">
              <dt>Order number</dt>
              <dd className="mono">{h.orderRef}</dd>
            </div>
          )}
          {h.expectedOn && h.stage === "ordered" && (
            <div className="kv-row">
              <dt>Expected</dt>
              <dd>{day(h.expectedOn)}</dd>
            </div>
          )}
          {h.receivedAt && (
            <div className="kv-row">
              <dt>Arrived</dt>
              <dd>
                <Time iso={h.receivedAt} />
                {h.receivedByName && <> · received by {h.receivedByName}</>}
              </dd>
            </div>
          )}
          {h.deliveryMethod && (
            <div className="kv-row">
              <dt>Delivery</dt>
              <dd>{h.deliveryMethod === "tech_setup" ? "A technician delivers and sets it up" : "Delivered for the user to set up"}</dd>
            </div>
          )}
          {h.deliveredAt && (
            <div className="kv-row">
              <dt>Delivered</dt>
              <dd>
                <Time iso={h.deliveredAt} />
                {h.deliveredByName && <> by {h.deliveredByName}</>}
              </dd>
            </div>
          )}
        </dl>
      )}

      {h.items.length > 0 && (
        <div className="stack-tight">
          <h3 className="label">Items</h3>
          <ul className="hw-items" role="list">
            {h.items.map((i) => (
              <li key={i.label}>
                {i.assetId ? <Link href={`/portal/devices/${i.assetId}`}>{i.label}</Link> : i.label}
              </li>
            ))}
          </ul>
          {h.canAct && assetIds.length > 0 && (
            <Link className="subtle" href={`/portal/devices/labels?ids=${assetIds.join(",")}`}>
              Print asset labels
            </Link>
          )}
        </div>
      )}

      {h.canAct && h.stage === "ordering" && !receivingEarly && (
        <>
          <OrderForm ticketId={ticketId} initial={h} submitLabel="Mark as ordered" />
          <button type="button" className="btn btn-ghost" onClick={() => setReceivingEarly(true)}>
            It&apos;s already here: receive it now
          </button>
        </>
      )}
      {h.canAct && h.stage === "ordering" && receivingEarly && <ReceiveForm ticketId={ticketId} requested={requested} onCancel={() => setReceivingEarly(false)} />}
      {h.canAct && h.stage === "ordered" && (
        <>
          {editing ? (
            <OrderForm ticketId={ticketId} initial={h} submitLabel="Save order details" onDone={() => setEditing(false)} />
          ) : (
            <div>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>
                Edit order details
              </button>
            </div>
          )}
          <h3 className="label">When it arrives</h3>
          <ReceiveForm ticketId={ticketId} requested={requested} />
        </>
      )}
      {h.canAct && h.stage === "received" && <DeliverForm ticketId={ticketId} method={h.deliveryMethod} />}
      {h.stage === "delivered" && (
        <p>
          <IconCheck size={14} /> Delivered.
        </p>
      )}
    </section>
  );
}
