/**
 * Business-hours arithmetic in a named IANA time zone. Pure functions, no
 * database access, so they can be tested across daylight-saving changes.
 *
 * Hours are wall-clock times in the calendar's zone. On a DST change day the
 * real length of a window follows the clock (a 08:00–17:00 window is still
 * 08:00–17:00 local), which is what people expect from "business hours".
 */
export interface BusinessCalendar {
  timeZone: string;
  /** Weekday (0 = Sunday … 6 = Saturday) → list of [start, end) "HH:MM" windows. */
  hours: Partial<Record<string, [string, string][]>>;
  /** Local dates (YYYY-MM-DD) with no business hours. */
  holidays: string[];
}

const MINUTE = 60_000;
const MAX_DAYS = 3660;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(tz: string) {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Local calendar fields of an instant in a zone. */
function local(at: number, timeZone: string) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour, min: +parts.minute, s: +parts.second };
}

/** Offset (ms) of the zone from UTC at an instant. */
function offsetAt(at: number, timeZone: string) {
  const l = local(at, timeZone);
  return Date.UTC(l.y, l.m - 1, l.d, l.h, l.min, l.s) - Math.floor(at / 1000) * 1000;
}

/**
 * The instant at which the zone's wall clock reads the given local time. A
 * time skipped by a spring-forward change maps to the instant just after the
 * gap; an ambiguous fall-back time maps to its first occurrence.
 */
export function zonedTime(y: number, m: number, d: number, h: number, min: number, timeZone: string) {
  const wall = Date.UTC(y, m - 1, d, h, min);
  const first = wall - offsetAt(wall, timeZone);
  const second = wall - offsetAt(first, timeZone);
  if (first === second) return first;
  // Ambiguous or skipped: prefer the earliest instant whose wall clock is not before the requested time.
  const candidates = [first, second].sort((a, b) => a - b);
  for (const c of candidates) {
    const l = local(c, timeZone);
    if (Date.UTC(l.y, l.m - 1, l.d, l.h, l.min) >= wall) return c;
  }
  return candidates[1];
}

const toMinutes = (hhmm: string) => {
  const m = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error(`Invalid time "${hhmm}"`);
  return Number(m[1]) * 60 + Number(m[2]);
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Business windows (UTC ms) for one local date, in order. */
function windowsFor(y: number, m: number, d: number, cal: BusinessCalendar): [number, number][] {
  const date = `${y}-${pad(m)}-${pad(d)}`;
  if (cal.holidays.includes(date)) return [];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const spans = cal.hours[String(weekday)] ?? [];
  const out: [number, number][] = [];
  for (const [s, e] of spans) {
    const sm = toMinutes(s);
    const em = toMinutes(e);
    if (em <= sm) continue;
    const start = zonedTime(y, m, d, Math.floor(sm / 60), sm % 60, cal.timeZone);
    // 24:00 is the start of the next local day.
    const end =
      em === 1440
        ? zonedTime(...nextDate(y, m, d), 0, 0, cal.timeZone)
        : zonedTime(y, m, d, Math.floor(em / 60), em % 60, cal.timeZone);
    if (end > start) out.push([start, end]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function nextDate(y: number, m: number, d: number): [number, number, number] {
  const n = new Date(Date.UTC(y, m - 1, d + 1));
  return [n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate()];
}

/** Iterates business windows from the local day containing `from`. */
function* windowsFrom(from: number, cal: BusinessCalendar) {
  let { y, m, d } = local(from, cal.timeZone);
  for (let i = 0; i < MAX_DAYS; i++) {
    for (const w of windowsFor(y, m, d, cal)) if (w[1] > from) yield [Math.max(w[0], from), w[1]] as [number, number];
    [y, m, d] = nextDate(y, m, d);
  }
}

export function hasBusinessHours(cal: BusinessCalendar) {
  return Object.values(cal.hours).some((spans) => (spans ?? []).some(([s, e]) => toMinutes(e) > toMinutes(s)));
}

/** The instant that is `minutes` business minutes after `start`. */
export function addBusinessMinutes(start: Date, minutes: number, cal: BusinessCalendar): Date {
  if (!hasBusinessHours(cal)) throw new Error("The calendar has no business hours.");
  let remaining = Math.max(0, Math.round(minutes)) * MINUTE;
  const from = start.getTime();
  if (remaining === 0) {
    // Zero minutes from outside hours is the next opening.
    const first = windowsFrom(from, cal).next();
    return new Date(first.done ? from : first.value[0]);
  }
  for (const [s, e] of windowsFrom(from, cal)) {
    const len = e - s;
    if (remaining <= len) return new Date(s + remaining);
    remaining -= len;
  }
  throw new Error("SLA target is beyond the calendar range.");
}

/** Whole business minutes between two instants (0 if b <= a). */
export function businessMinutesBetween(a: Date, b: Date, cal: BusinessCalendar): number {
  const from = a.getTime();
  const to = b.getTime();
  if (to <= from || !hasBusinessHours(cal)) return 0;
  let total = 0;
  for (const [s, e] of windowsFrom(from, cal)) {
    if (s >= to) break;
    total += Math.min(e, to) - s;
  }
  return Math.floor(total / MINUTE);
}
