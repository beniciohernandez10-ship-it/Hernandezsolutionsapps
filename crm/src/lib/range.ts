import { addDays, dayKey, endOfDay, startOfDay } from "./dates";

export const PRESETS = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "365d", label: "Last 12 months", days: 365 },
] as const;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse ?preset= or ?from=&to= (business-time-zone days) into a range. Defaults to the last 30 days. */
export function parseRange(sp: Record<string, string | string[] | undefined>) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const today = dayKey();
  const from = one(sp.from);
  const to = one(sp.to);
  if (from && to && DAY_RE.test(from) && DAY_RE.test(to) && from <= to) {
    return { fromDay: from, toDay: to, preset: null as string | null, from: startOfDay(from), to: endOfDay(to) };
  }
  const preset = PRESETS.find((p) => p.key === one(sp.preset)) ?? PRESETS[1];
  const fromDay = addDays(today, -(preset.days - 1));
  return { fromDay, toDay: today, preset: preset.key as string | null, from: startOfDay(fromDay), to: endOfDay(today) };
}
