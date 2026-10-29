import { describe, expect, it } from "vitest";
import { describeSchedule, fillPlaceholders, nextIndexAfter, occurrence, ordinal } from "@/lib/recurring/schedule";

describe("occurrence", () => {
  it("counts days and weeks from the start", () => {
    expect(occurrence("2026-11-03", "daily", 1, 0)).toBe("2026-11-03");
    expect(occurrence("2026-11-03", "daily", 3, 2)).toBe("2026-11-09");
    expect(occurrence("2026-12-28", "weekly", 1, 1)).toBe("2027-01-04");
    expect(occurrence("2026-11-02", "weekly", 2, 3)).toBe("2026-12-14");
  });

  it("keeps the day of the month, using the last day when a month is shorter", () => {
    expect(occurrence("2026-01-31", "monthly", 1, 1)).toBe("2026-02-28");
    expect(occurrence("2026-01-31", "monthly", 1, 2)).toBe("2026-03-31");
    expect(occurrence("2027-12-31", "monthly", 2, 1)).toBe("2028-02-29");
    expect(occurrence("2026-11-15", "quarterly", 1, 1)).toBe("2027-02-15");
    expect(occurrence("2028-02-29", "yearly", 1, 1)).toBe("2029-02-28");
    expect(occurrence("2028-02-29", "yearly", 1, 4)).toBe("2032-02-29");
  });

  it("jumps past missed dates instead of catching up one by one", () => {
    // Monthly from Jan 10; on May 20 the next date after occurrence 1 is June 10 (index 5).
    expect(nextIndexAfter("2026-01-10", "monthly", 1, 1, "2026-05-20")).toBe(5);
    expect(nextIndexAfter("2026-01-10", "monthly", 1, 0, "2026-01-10")).toBe(1);
  });
});

describe("describing and filling in", () => {
  it("reads naturally", () => {
    expect(describeSchedule("2026-11-15", "monthly", 1)).toBe("Every month on the 15th");
    expect(describeSchedule("2026-11-30", "quarterly", 1)).toBe("Every quarter on the 30th (or the last day)");
    expect(describeSchedule("2026-11-02", "weekly", 2)).toBe("Every 2 weeks on Monday");
    expect(describeSchedule("2026-03-01", "yearly", 1)).toBe("Every year on March 1");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal).join(" ")).toBe("1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd");
  });

  it("fills placeholders from the date", () => {
    expect(fillPlaceholders("Patch review – {month} ({quarter}, {year}) {date}", "2026-11-15")).toBe("Patch review – November 2026 (Q4 2026, 2026) 2026-11-15");
  });
});
