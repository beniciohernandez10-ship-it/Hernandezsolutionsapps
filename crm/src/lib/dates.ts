/** Business time zone for "today", call queues and due dates. */
export const BUSINESS_TZ = process.env.BUSINESS_TZ || "America/Los_Angeles";

/** "YYYY-MM-DD" for the given instant in the business time zone. */
export function dayKey(date: Date = new Date(), tz = BUSINESS_TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Offset in minutes between UTC and the time zone at the given instant. */
function tzOffsetMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - date.getTime()) / 60000;
}

/** The UTC instant of local midnight starting the given "YYYY-MM-DD" day in the business time zone. */
export function startOfDay(day: string, tz = BUSINESS_TZ): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const offset = tzOffsetMinutes(guess, tz);
  const first = new Date(guess.getTime() - offset * 60000);
  // Re-check across DST transitions.
  const offset2 = tzOffsetMinutes(first, tz);
  return offset2 === offset ? first : new Date(guess.getTime() - offset2 * 60000);
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function endOfDay(day: string, tz = BUSINESS_TZ): Date {
  return startOfDay(addDays(day, 1), tz);
}

/** 0 = Sunday … 6 = Saturday for a "YYYY-MM-DD" day. */
export function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Next workday (Mon–Fri) after the given day. */
export function nextWorkday(day: string): string {
  let next = addDays(day, 1);
  while (weekday(next) === 0 || weekday(next) === 6) next = addDays(next, 1);
  return next;
}

/** Monday of the week containing the given day. */
export function startOfWeekDay(day: string): string {
  const wd = weekday(day);
  return addDays(day, wd === 0 ? -6 : 1 - wd);
}

/** Parse an <input type="datetime-local"> value as business-time-zone wall time. */
export function parseLocalDateTime(value: string, tz = BUSINESS_TZ): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const base = startOfDay(m[1], tz);
  return new Date(base.getTime() + (Number(m[2]) * 60 + Number(m[3])) * 60000);
}

/** Format a Date for an <input type="datetime-local"> in the business time zone. */
export function toLocalInput(date: Date | null | undefined, tz = BUSINESS_TZ): string {
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function formatDate(date: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, ...opts }).format(d);
}

export function formatDateTime(date: Date | string | null | undefined): string {
  return formatDate(date, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
