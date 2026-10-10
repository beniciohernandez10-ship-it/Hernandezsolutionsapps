import { qrPath, type QrMatrix } from "@/lib/assets/qr";

export function QrCode({ qr, label, size = 160 }: { qr: QrMatrix; label: string; size?: number }) {
  const n = qr.size + 4;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox={`-2 -2 ${n} ${n}`} role="img" aria-label={label} className="qr">
      <rect x={-2} y={-2} width={n} height={n} fill="#ffffff" />
      <path d={qrPath(qr)} fill="#000000" shapeRendering="crispEdges" />
    </svg>
  );
}
