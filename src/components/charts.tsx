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

export interface LineSeries {
  key: string;
  label: string;
  /** One value per x position; null leaves a gap (nothing to measure that period). */
  values: (number | null)[];
}

/**
 * Line chart for a few series over time (validated slots --series-1 and
 * --series-2, in that order). Legend above, each line labelled at its end,
 * and a crosshair with every series' value on hover or focus.
 */
export function LineChart({
  title,
  series,
  labels,
  details,
  max: fixedMax,
  suffix = "",
}: {
  title: string;
  series: LineSeries[];
  labels: string[];
  /** Tooltip heading per x position, e.g. "Week of Nov 3". */
  details: string[];
  /** Fixed top of the scale (100 for percentages). */
  max?: number;
  suffix?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const W = 720;
  const H = 200;
  const pad = { l: 36, r: 96, t: 12, b: 24 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const count = labels.length;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = fixedMax ?? niceMax(Math.max(0, ...all));
  const x = (i: number) => pad.l + (count <= 1 ? plotW / 2 : (i / (count - 1)) * plotW);
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(count / 8);
  const band = plotW / Math.max(1, count - 1);
  const path = (values: (number | null)[]) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i)},${y(v)} `;
      pen = true;
    });
    return d.trim();
  };
  const lastPoint = (values: (number | null)[]) => {
    for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return { i, v: values[i] as number };
    return null;
  };
  const ends = series.flatMap((s, k) => {
    const p = lastPoint(s.values);
    return p ? [{ k, p }] : [];
  });
  // Keep two end labels from colliding.
  const labelY = ends.map((e) => y(e.p.v));
  if (labelY.length === 2 && Math.abs(labelY[0] - labelY[1]) < 12) {
    const mid = (labelY[0] + labelY[1]) / 2;
    const up = labelY[0] <= labelY[1] ? 0 : 1;
    labelY[up] = mid - 6;
    labelY[1 - up] = mid + 6;
  }
  const fmt = (v: number | null) => (v === null ? "—" : `${v}${suffix}`);
  const isolated = (values: (number | null)[], i: number) => values[i] !== null && (values[i - 1] ?? null) === null && (values[i + 1] ?? null) === null;
  return (
    <figure className="viz-root chart">
      <figcaption className="chart-title">{title}</figcaption>
      {series.length > 1 && (
        <ul className="chart-legend" role="list">
          {series.map((s, k) => (
            <li key={s.key}>
              <svg viewBox="0 0 16 4" className="legend-swatch" aria-hidden="true">
                <line x1="0" x2="16" y1="2" y2="2" className={`line series-${k + 1}`} />
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${series.map((s) => s.label).join(" and ")} over ${count} periods. A table of the values follows.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? "axis" : "grid"} />
              <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="tick">
                {Math.round(t)}
                {suffix}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % labelEvery === 0 ? (
              <text key={`${l}-${i}`} x={x(i)} y={H - 6} textAnchor="middle" className="tick">{l}</text>
            ) : null,
          )}
          {active !== null && <line x1={x(active)} x2={x(active)} y1={pad.t} y2={pad.t + plotH} className="crosshair" />}
          {series.map((s, k) => (
            <path key={s.key} d={path(s.values)} className={`line series-${k + 1}`} />
          ))}
          {/* A lone point between gaps draws no line, so mark it. */}
          {series.map((s, k) =>
            s.values.map((v, i) => (v !== null && isolated(s.values, i) ? <circle key={`${s.key}-${i}`} cx={x(i)} cy={y(v)} r="3" className={`dot series-${k + 1}`} /> : null)),
          )}
          {active !== null &&
            series.map((s, k) => {
              const v = s.values[active];
              return v !== null ? <circle key={s.key} cx={x(active)} cy={y(v)} r="4.5" className={`dot is-active series-${k + 1}`} /> : null;
            })}
          {ends.map((e, j) => (
            <text key={series[e.k].key} x={x(e.p.i) + 8} y={labelY[j]} dy="0.32em" className="end-label">
              {series[e.k].label} {fmt(e.p.v)}
            </text>
          ))}
          {labels.map((l, i) => (
            <rect
              key={`hit-${l}-${i}`}
              x={x(i) - band / 2}
              y={pad.t}
              width={band}
              height={plotH}
              className="hit"
              tabIndex={0}
              aria-label={`${details[i]}: ${series.map((s) => `${s.label} ${fmt(s.values[i])}`).join(", ")}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          ))}
        </svg>
        {active !== null && (
          <div className="chart-tip" role="status" style={{ left: `${(x(active) / W) * 100}%` }}>
            <strong>{details[active]}</strong>
            {series.map((s) => (
              <span key={s.key}>
                {s.label}: {fmt(s.values[active])}
              </span>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}
