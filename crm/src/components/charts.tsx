"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

const axis = { stroke: "var(--fg-subtle)", fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--fg)" },
  labelStyle: { color: "var(--fg-muted)" },
  cursor: { fill: "var(--surface-2)" },
};

const money = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, notation: v >= 100000 ? "compact" : "standard" }).format(v);

export interface Series {
  key: string;
  label: string;
}

export function BarChartView({
  data, xKey, series, height = 260, currency, horizontal, stacked,
}: {
  data: Record<string, string | number>[];
  xKey: string;
  series: Series[];
  height?: number;
  currency?: boolean;
  horizontal?: boolean;
  stacked?: boolean;
}) {
  if (!data.length) return <p className="py-10 text-center text-sm text-muted">No data yet.</p>;
  const fmt = currency ? money : (v: number) => String(v);
  return (
    <div style={{ height: horizontal ? Math.max(height, data.length * 28 + 40) : height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, left: horizontal ? 8 : -8, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" {...axis} tickFormatter={fmt} />
              <YAxis type="category" dataKey={xKey} {...axis} width={140} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} {...axis} interval="preserveStartEnd" />
              <YAxis {...axis} tickFormatter={fmt} allowDecimals={false} />
            </>
          )}
          <Tooltip {...tooltipStyle} formatter={(v) => fmt(Number(v))} />
          {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={COLORS[i % COLORS.length]} radius={stacked ? 0 : 3} stackId={stacked ? "a" : undefined} maxBarSize={36} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LineChartView({ data, xKey, series, height = 260 }: { data: Record<string, string | number>[]; xKey: string; series: Series[]; height?: number }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-muted">No data yet.</p>;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} {...axis} interval="preserveStartEnd" />
          <YAxis {...axis} allowDecimals={false} />
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s, i) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutView({ data, height = 240 }: { data: { label: string; value: number }[]; height?: number }) {
  const shown = data.filter((d) => d.value > 0);
  if (!shown.length) return <p className="py-10 text-center text-sm text-muted">No data yet.</p>;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={shown} dataKey="value" nameKey="label" innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke="var(--surface)">
            {shown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} layout="vertical" align="right" verticalAlign="middle" />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
