"use client";
import { useState } from "react";

/*
 * Small single-series charts for reports. One validated hue (--series-1,
 * stepped separately for dark and light surfaces), thin marks with a 4px
 * rounded data end, recessive grid, text in text colours, a hover/focus
 * tooltip on every mark, and a table view alongside (rendered by the page).
 */

export interface ColumnDatum {
  key: string;
  label: string;
  value: number;
  /** Tooltip text, e.g. "Mon 3 Nov: 4 opened". */
  detail: string;
}

function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

/** Column chart over a time axis (e.g. requests opened per day). */
export function ColumnChart({ data, title, valueLabel }: { data: ColumnDatum[]; title: string; valueLabel: string }) {
  const [active, setActive] = useState<number | null>(null);
  const W = 720;
  const H = 200;
  const pad = { l: 32, r: 8, t: 12, b: 24 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const band = plotW / Math.max(1, data.length);
  const bw = Math.min(24, Math.max(3, band - 4));
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  const labelEvery = Math.ceil(data.length / 8);
  const a = active !== null ? data[active] : null;
  return (
    <figure className="viz-root chart">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${data.length} values; highest ${data[peak]?.value ?? 0} on ${data[peak]?.label ?? ""}. A table of the values follows.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? "axis" : "grid"} />
              <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="tick">{t}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = pad.l + i * band + (band - bw) / 2;
            const top = y(d.value);
            const h = pad.t + plotH - top;
            const r = Math.min(4, h, bw / 2);
            return (
              <g key={d.key}>
                {d.value > 0 && (
                  <path
                    className={`mark${active === i ? " is-active" : ""}`}
                    d={`M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${top + h} Z`}
                  />
                )}
                {i === peak && d.value > 0 && (
                  <text x={x + bw / 2} y={top - 4} textAnchor="middle" className="value">{d.value}</text>
                )}
                {i % labelEvery === 0 && (
                  <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="tick">{d.label}</text>
                )}
                {/* Hit target larger than the mark: the whole column band. */}
                <rect
                  x={pad.l + i * band}
                  y={pad.t}
                  width={band}
                  height={plotH}
                  className="hit"
                  tabIndex={0}
                  aria-label={d.detail}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
        {a && active !== null && (
          <div className="chart-tip" role="status" style={{ left: `${((pad.l + active * band + band / 2) / W) * 100}%` }}>
            <strong>{a.value}</strong> {valueLabel}
            <span>{a.detail}</span>
          </div>
        )}
      </div>
    </figure>
  );
}

export interface BarDatum {
  key: string;
  label: string;
  value: number;
}

/** Horizontal bars for comparing a handful of categories; value at the tip. */
export function BarList({ data, title, total }: { data: BarDatum[]; title: string; total: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure className="viz-root chart">
      <figcaption className="chart-title">{title}</figcaption>
      {data.length === 0 ? (
        <p className="subtle">Nothing yet.</p>
      ) : (
        <ul className="bar-list" role="list">
          {data.map((d) => {
            const pct = total ? Math.round((d.value / total) * 100) : 0;
            return (
              <li key={d.key} className="bar-row" tabIndex={0} aria-label={`${d.label}: ${d.value} (${pct}%)`}>
                <span className="bar-label">{d.label}</span>
                {/* SVG geometry, not inline styles: the portal CSP blocks style attributes. */}
                <span className="bar-track">
                  <svg className="bar-svg" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
                    <rect className="mark" x="0" y="0" width={Math.max(0.5, (d.value / max) * 100)} height="12" rx="0" />
                  </svg>
                  <span className="bar-value">{d.value}</span>
                </span>
                <span className="chart-tip bar-tip" aria-hidden="true">
                  {d.value} · {pct}% of {total}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </figure>
  );
}
