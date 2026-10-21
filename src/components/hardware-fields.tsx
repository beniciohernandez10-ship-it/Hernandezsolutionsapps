/** Optional hardware details for a registered device; read with hardwareFrom(FormData). */
export interface HardwareValues {
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  purchaseDate?: string | null;
  warrantyExpires?: string | null;
}

export function HardwareFields({ initial = {}, open = false }: { initial?: HardwareValues; open?: boolean }) {
  return (
    <details className="hardware-fields" open={open}>
      <summary>Hardware details (optional)</summary>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="hw-manufacturer">Manufacturer</label>
          <input id="hw-manufacturer" name="manufacturer" className="input" maxLength={80} defaultValue={initial.manufacturer ?? ""} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="hw-model">Model</label>
          <input id="hw-model" name="model" className="input" maxLength={120} defaultValue={initial.model ?? ""} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="hw-serial">Serial number</label>
          <input id="hw-serial" name="serialNumber" className="input" maxLength={80} defaultValue={initial.serialNumber ?? ""} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="hw-purchase">Purchase date</label>
          <input id="hw-purchase" name="purchaseDate" type="date" className="input" defaultValue={initial.purchaseDate ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="hw-warranty">Warranty ends</label>
          <input id="hw-warranty" name="warrantyExpires" type="date" className="input" defaultValue={initial.warrantyExpires ?? ""} />
        </div>
      </div>
    </details>
  );
}

export function hardwareFrom(fd: FormData) {
  const v = (k: string) => String(fd.get(k) ?? "").trim();
  return { manufacturer: v("manufacturer"), model: v("model"), serialNumber: v("serialNumber"), purchaseDate: v("purchaseDate"), warrantyExpires: v("warrantyExpires") };
}
