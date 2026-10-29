/** Pure date math for recurring tickets. Dates are calendar days, "YYYY-MM-DD". */

export const FREQUENCIES = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

const MONTHS: Partial<Record<Frequency, number>> = { monthly: 1, quarterly: 3, yearly: 12 };
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const parse = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, day };
};
const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * The k-th occurrence (k = 0 is the start date). Counted from the start, not
 * from the previous run, so a schedule that starts on the 31st falls on the
 * last day of shorter months and comes back to the 31st afterwards.
 */
export function occurrence(startsOn: string, frequency: Frequency, interval: number, k: number): string {
  const { y, m, day } = parse(startsOn);
  const months = MONTHS[frequency];
  if (months) {
    const total = y * 12 + (m - 1) + months * interval * k;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    return iso(ny, nm, Math.min(day, daysIn(ny, nm)));
  }
  const step = (frequency === "weekly" ? 7 : 1) * interval * k;
  const d = new Date(Date.UTC(y, m - 1, day + step));
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** The first occurrence index after `k` that falls after `today` (missed dates aren't caught up one by one). */
export function nextIndexAfter(startsOn: string, frequency: Frequency, interval: number, k: number, today: string) {
  let n = k + 1;
  // Bounded: a daily schedule years behind still stops (and occurrences only grow).
  for (let guard = 0; occurrence(startsOn, frequency, interval, n) <= today && guard < 100_000; guard++) n++;
  return n;
}

/** "Every month on the 15th", "Every 2 weeks on Monday". */
export function describeSchedule(startsOn: string, frequency: Frequency, interval: number) {
  const { y, m, day } = parse(startsOn);
  const unit = { daily: "day", weekly: "week", monthly: "month", quarterly: "quarter", yearly: "year" }[frequency];
  const every = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
  if (frequency === "daily") return every;
  if (frequency === "weekly") return `${every} on ${WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]}`;
  const dayText = day >= 29 ? `the ${ordinal(day)} (or the last day)` : `the ${ordinal(day)}`;
  if (frequency === "yearly") return `${every} on ${MONTH_NAMES[m - 1]} ${day}`;
  return `${every} on ${dayText}`;
}

export function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/**
 * Fills placeholders in a title or description with the occurrence date:
 * {date} 2026-11-15, {month} November 2026, {quarter} Q4 2026, {year} 2026.
 */
export function fillPlaceholders(text: string, date: string) {
  const { y, m } = parse(date);
  return text
    .replaceAll("{date}", date)
    .replaceAll("{month}", `${MONTH_NAMES[m - 1]} ${y}`)
    .replaceAll("{quarter}", `Q${Math.floor((m - 1) / 3) + 1} ${y}`)
    .replaceAll("{year}", String(y));
}
