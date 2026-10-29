/**
 * Pure billing arithmetic (no I/O), shared by the service, the UI and tests.
 * Minutes are integers; money is integer US cents.
 */

export type ContractKind = "retainer" | "block" | "hourly";

export interface ContractTerms {
  kind: ContractKind;
  monthlyFeeCents: number;
  /** Retainer: per month. Block: in total since `startsOn`. */
  includedMinutes: number;
  hourlyRateCents: number;
  roundingMinutes: number;
}

export interface MonthTotals {
  /** Billable minutes after per-entry rounding. */
  billableMinutes: number;
  nonBillableMinutes: number;
  /** Included minutes still available at the start of the month (block) or this month (retainer). */
  includedAvailableMinutes: number;
  /** Billable minutes beyond what's included. */
  overageMinutes: number;
  /** Block only: balance after this month (negative = overdrawn). */
  blockBalanceAfterMinutes: number | null;
  feeCents: number;
  overageCents: number;
  totalCents: number;
}

/** Rounds one entry up to the contract's increment (15 → 7 min becomes 15). */
export const roundEntry = (minutes: number, increment: number) => (increment <= 1 ? minutes : Math.ceil(minutes / increment) * increment);

const money = (minutes: number, rateCents: number) => Math.round((minutes * rateCents) / 60);

/**
 * One month for one client. `entries` are this month's entries;
 * `priorBillableMinutes` (block contracts) is the rounded billable time used
 * from the block's start up to the start of this month.
 */
export function computeMonth(terms: ContractTerms | null, entries: { minutes: number; billable: boolean }[], priorBillableMinutes = 0): MonthTotals {
  const increment = terms?.roundingMinutes ?? 1;
  const billableMinutes = entries.filter((e) => e.billable).reduce((n, e) => n + roundEntry(e.minutes, increment), 0);
  const nonBillableMinutes = entries.filter((e) => !e.billable).reduce((n, e) => n + e.minutes, 0);
  if (!terms) {
    return { billableMinutes, nonBillableMinutes, includedAvailableMinutes: 0, overageMinutes: 0, blockBalanceAfterMinutes: null, feeCents: 0, overageCents: 0, totalCents: 0 };
  }
  let available = 0;
  let blockAfter: number | null = null;
  let feeCents = 0;
  if (terms.kind === "retainer") {
    available = terms.includedMinutes;
    feeCents = terms.monthlyFeeCents;
  } else if (terms.kind === "block") {
    const balance = terms.includedMinutes - priorBillableMinutes;
    available = Math.max(0, balance);
    blockAfter = balance - billableMinutes;
  }
  const overageMinutes = terms.kind === "hourly" ? billableMinutes : Math.max(0, billableMinutes - available);
  const overageCents = money(overageMinutes, terms.hourlyRateCents);
  return {
    billableMinutes,
    nonBillableMinutes,
    includedAvailableMinutes: available,
    overageMinutes,
    blockBalanceAfterMinutes: blockAfter,
    feeCents,
    overageCents,
    totalCents: feeCents + overageCents,
  };
}

/**
 * Reads a duration the way people type it: "45", "45m", "1h", "1.5h",
 * "1h 30m", "1:30". Bare numbers are minutes. Returns null if unreadable or
 * outside 1 minute to 24 hours.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  let minutes: number | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2}):([0-5]\d)$/.exec(s))) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = /^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?$/.exec(s))) minutes = Math.round(Number(m[1]) * 60);
  else if ((m = /^(\d+)\s*h(?:ours?|rs?)?\s*(\d+)\s*m(?:in(?:utes?|s)?)?$/.exec(s))) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = /^(\d+)\s*m(?:in(?:utes?|s)?)?$/.exec(s))) minutes = Number(m[1]);
  else if ((m = /^(\d+)$/.exec(s))) minutes = Number(m[1]);
  return minutes !== null && minutes >= 1 && minutes <= 1440 ? minutes : null;
}

/** 95 → "1h 35m", 60 → "1h", 20 → "20m". */
export function formatMinutes(total: number) {
  const sign = total < 0 ? "-" : "";
  const n = Math.abs(total);
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${sign}${h ? `${h}h` : ""}${h && m ? " " : ""}${m || !h ? `${m}m` : ""}`;
}

/** Decimal hours for invoices: 95 → "1.58". */
export const decimalHours = (minutes: number) => (minutes / 60).toFixed(2);

export const formatUsd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** First and last day of a YYYY-MM month as YYYY-MM-DD. */
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** "2026-10" → "October 2026". */
export function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Moves a YYYY-MM month by n months. */
export function shiftMonth(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
