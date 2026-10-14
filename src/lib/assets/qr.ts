import QRCode from "qrcode";

export interface QrMatrix {
  size: number;
  /** Row-major "1"/"0" string; serializable to client components. */
  bits: string;
}

/** Medium error correction: survives some wear on a stuck-on label. */
export function qrMatrix(text: string): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  let bits = "";
  for (let i = 0; i < size * size; i++) bits += qr.modules.data[i] ? "1" : "0";
  return { size, bits };
}

/** One SVG path for all dark modules, drawn in module units. */
export function qrPath({ size, bits }: QrMatrix) {
  let d = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (bits[y * size + x] === "1") d += `M${x} ${y}h1v1h-1z`;
  }
  return d;
}
