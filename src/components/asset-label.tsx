import { qrPath, type QrMatrix } from "@/lib/assets/qr";

/**
 * A label for 24 mm TZe tape (Brother P-touch D610BT): QR code on the left,
 * the device name in large type on the right. Drawn entirely in SVG with
 * presentation attributes (no inline CSS), in millimetres, so it prints at
 * true size and can be exported to PNG for the P-touch Design&Print app.
 */
export const LABEL_MM = { width: 64, height: 24 } as const;

export function AssetLabel({ tag, qr, id }: { tag: string; qr: QrMatrix; id?: string }) {
  const quiet = 2; // quiet-zone modules on each side
  const qrMm = 18;
  const scale = qrMm / (qr.size + quiet * 2);
  const textX = 3 + qrMm + 2;
  const maxText = LABEL_MM.width - textX - 2;
  // Bold sans digits/caps are roughly 0.62 em wide; compress only if needed.
  const fontMm = 6.2;
  const natural = tag.length * fontMm * 0.62;
  return (
    <svg
      id={id}
      xmlns="http://www.w3.org/2000/svg"
      width={`${LABEL_MM.width}mm`}
      height={`${LABEL_MM.height}mm`}
      viewBox={`0 0 ${LABEL_MM.width} ${LABEL_MM.height}`}
      role="img"
      aria-label={`Label for ${tag}`}
      className="asset-label"
    >
      <rect width={LABEL_MM.width} height={LABEL_MM.height} fill="#ffffff" />
      <g transform={`translate(3 3) scale(${scale}) translate(${quiet} ${quiet})`}>
        <path d={qrPath(qr)} fill="#000000" shapeRendering="crispEdges" />
      </g>
      <text
        x={textX}
        y={13.2}
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight={700}
        fontSize={fontMm}
        fill="#000000"
        {...(natural > maxText ? { textLength: maxText, lengthAdjust: "spacingAndGlyphs" } : {})}
      >
        {tag}
      </text>
      <text x={textX} y={18.6} fontFamily="Arial, Helvetica, sans-serif" fontSize={2.4} fill="#000000">
        Scan for IT support
      </text>
    </svg>
  );
}
