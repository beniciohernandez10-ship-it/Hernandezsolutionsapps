import { describe, expect, it } from "vitest";
import { addBusinessMinutes, businessMinutesBetween, zonedTime, type BusinessCalendar } from "@/lib/sla/calendar";

const weekdays = Object.fromEntries(["1", "2", "3", "4", "5"].map((d) => [d, [["08:00", "17:00"]] as [string, string][]]));
const LA: BusinessCalendar = { timeZone: "America/Los_Angeles", hours: weekdays, holidays: [] };
const iso = (d: Date) => d.toISOString();

describe("zonedTime", () => {
  it("converts wall time in standard and daylight time", () => {
    expect(new Date(zonedTime(2026, 1, 15, 8, 0, "America/Los_Angeles")).toISOString()).toBe("2026-01-15T16:00:00.000Z");
    expect(new Date(zonedTime(2026, 7, 15, 8, 0, "America/Los_Angeles")).toISOString()).toBe("2026-07-15T15:00:00.000Z");
  });

  it("maps a skipped spring-forward time to after the gap", () => {
    expect(new Date(zonedTime(2026, 3, 8, 2, 30, "America/Los_Angeles")).toISOString()).toBe("2026-03-08T10:30:00.000Z");
  });

  it("maps an ambiguous fall-back time to its first occurrence", () => {
    expect(new Date(zonedTime(2026, 11, 1, 1, 30, "America/Los_Angeles")).toISOString()).toBe("2026-11-01T08:30:00.000Z");
  });
});

describe("addBusinessMinutes", () => {
  it("adds within a business day", () => {
    // Wed 2026-01-14 09:00 PST = 17:00Z
    expect(iso(addBusinessMinutes(new Date("2026-01-14T17:00:00Z"), 60, LA))).toBe("2026-01-14T18:00:00.000Z");
  });

  it("starts the clock at the next opening when created after hours", () => {
    // Wed 18:00 PST → Thu 08:00 PST + 60 min = Thu 09:00 PST
    expect(iso(addBusinessMinutes(new Date("2026-01-15T02:00:00Z"), 60, LA))).toBe("2026-01-15T17:00:00.000Z");
  });

  it("rolls over the weekend", () => {
    // Fri 16:00 PST + 120 min → 60 on Friday, 60 on Monday → Mon 09:00 PST
    expect(iso(addBusinessMinutes(new Date("2026-01-17T00:00:00Z"), 120, LA))).toBe("2026-01-19T17:00:00.000Z");
  });

  it("skips holidays", () => {
    const cal = { ...LA, holidays: ["2026-01-19"] };
    // Fri 16:00 + 120 → Mon is a holiday → Tue 09:00 PST
    expect(iso(addBusinessMinutes(new Date("2026-01-17T00:00:00Z"), 120, cal))).toBe("2026-01-20T17:00:00.000Z");
  });

  it("is correct across the spring-forward weekend", () => {
    // Fri 2026-03-06 16:00 PST (00:00Z Sat) + 120 → Mon 2026-03-09 09:00 PDT = 16:00Z
    expect(iso(addBusinessMinutes(new Date("2026-03-07T00:00:00Z"), 120, LA))).toBe("2026-03-09T16:00:00.000Z");
  });

  it("is correct across the fall-back weekend", () => {
    // Fri 2026-10-30 16:00 PDT (23:00Z) + 120 → Mon 2026-11-02 09:00 PST = 17:00Z
    expect(iso(addBusinessMinutes(new Date("2026-10-30T23:00:00Z"), 120, LA))).toBe("2026-11-02T17:00:00.000Z");
  });

  it("supports split days and 24-hour coverage", () => {
    const split: BusinessCalendar = { timeZone: "UTC", hours: { "1": [["09:00", "12:00"], ["13:00", "17:00"]] }, holidays: [] };
    // Mon 2026-01-19 11:30 + 60 → 30 before lunch, 30 after → 13:30
    expect(iso(addBusinessMinutes(new Date("2026-01-19T11:30:00Z"), 60, split))).toBe("2026-01-19T13:30:00.000Z");
    const allDay: BusinessCalendar = { timeZone: "UTC", hours: Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [["00:00", "24:00"]] as [string, string][]])), holidays: [] };
    expect(iso(addBusinessMinutes(new Date("2026-01-17T23:00:00Z"), 120, allDay))).toBe("2026-01-18T01:00:00.000Z");
  });

  it("refuses a calendar without hours", () => {
    expect(() => addBusinessMinutes(new Date(), 10, { timeZone: "UTC", hours: {}, holidays: [] })).toThrow();
  });
});

describe("businessMinutesBetween", () => {
  it("counts only business time", () => {
    // Fri 16:00 PST → Mon 09:00 PST = 60 + 60
    expect(businessMinutesBetween(new Date("2026-01-17T00:00:00Z"), new Date("2026-01-19T17:00:00Z"), LA)).toBe(120);
  });

  it("is the inverse of addBusinessMinutes", () => {
    const start = new Date("2026-03-05T20:13:00Z");
    for (const n of [1, 59, 540, 1000, 5400]) {
      expect(businessMinutesBetween(start, addBusinessMinutes(start, n, LA), LA)).toBe(n);
    }
  });

  it("is zero for reversed or empty ranges", () => {
    const t = new Date("2026-01-14T17:00:00Z");
    expect(businessMinutesBetween(t, t, LA)).toBe(0);
    expect(businessMinutesBetween(t, new Date(t.getTime() - 1000), LA)).toBe(0);
  });
});
