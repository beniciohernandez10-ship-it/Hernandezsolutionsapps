"use client";
import { useEffect, useState } from "react";

const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }) : null;

function relative(iso: string) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [u, s] of units) if (abs >= s) return rtf!.format(Math.round(diff / s), u);
  return "just now";
}

/** Renders a timestamp in the viewer's locale and time zone (UTC on the server, localized after hydration). */
export function Time({ iso, mode = "relative" }: { iso: string | null; mode?: "relative" | "absolute" }) {
  const [text, setText] = useState(() => (iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—"));
  useEffect(() => {
    if (!iso) return;
    setText(mode === "relative" ? relative(iso) : new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  }, [iso, mode]);
  if (!iso) return <span>—</span>;
  return (
    <time dateTime={iso} title={new Date(iso).toUTCString()} suppressHydrationWarning>
      {text}
    </time>
  );
}
