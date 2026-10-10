"use client";
import { useState } from "react";
import { LABEL_MM } from "@/components/asset-label";

/** 360 dpi PNG of the on-page label SVG, for the Brother P-touch Design&Print app. */
export function LabelDownload({ svgId, tag }: { svgId: string; tag: string }) {
  const [error, setError] = useState<string | null>(null);
  async function download() {
    setError(null);
    const svg = document.getElementById(svgId);
    if (!svg) return;
    const dpmm = 360 / 25.4;
    const w = Math.round(LABEL_MM.width * dpmm);
    const h = Math.round(LABEL_MM.height * dpmm);
    const xml = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("render"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("png");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${tag}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {
      setError("Couldn't create the image in this browser. Use Print instead.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return (
    <>
      <button type="button" className="btn" onClick={download}>Download PNG</button>
      {error && <span className="field-error" role="alert">{error}</span>}
    </>
  );
}
