import { describe, expect, it } from "vitest";
import { computeMonth, formatMinutes, monthRange, parseDuration, roundEntry, type ContractTerms } from "@/lib/billing/compute";

const retainer: ContractTerms = { kind: "retainer", monthlyFeeCents: 150000, includedMinutes: 600, hourlyRateCents: 12500, roundingMinutes: 15 };
const block: ContractTerms = { kind: "block", monthlyFeeCents: 0, includedMinutes: 1200, hourlyRateCents: 15000, roundingMinutes: 1 };
const hourly: ContractTerms = { kind: "hourly", monthlyFeeCents: 0, includedMinutes: 0, hourlyRateCents: 13500, roundingMinutes: 6 };
const e = (minutes: number, billable = true) => ({ minutes, billable });

describe("rounding", () => {
  it("rounds each entry up to the increment", () => {
    expect(roundEntry(7, 15)).toBe(15);
    expect(roundEntry(15, 15)).toBe(15);
    expect(roundEntry(16, 15)).toBe(30);
    expect(roundEntry(7, 1)).toBe(7);
    expect(roundEntry(13, 6)).toBe(18);
  });
});

describe("a month's bill", () => {
  it("retainer: fee covers the included hours, overage at the rate", () => {
    // 3 entries: 50→60, 7→15, 590→600 = 675 billable; 600 included → 75 min over at $125/h.
    const t = computeMonth(retainer, [e(50), e(7), e(590), e(120, false)]);
    expect(t).toMatchObject({ billableMinutes: 675, nonBillableMinutes: 120, overageMinutes: 75, feeCents: 150000, overageCents: 15625, totalCents: 165625 });
  });

  it("retainer under the included hours: just the fee", () => {
    expect(computeMonth(retainer, [e(30)])).toMatchObject({ overageMinutes: 0, totalCents: 150000 });
  });

  it("block: draws down the balance across months, then bills the rest", () => {
    // 1200 min block, 1000 used before this month → 200 left; 300 used now → 100 over.
    const t = computeMonth(block, [e(300)], 1000);
    expect(t).toMatchObject({ includedAvailableMinutes: 200, overageMinutes: 100, blockBalanceAfterMinutes: -100, overageCents: 25000, totalCents: 25000 });
    expect(computeMonth(block, [e(100)], 0)).toMatchObject({ overageMinutes: 0, blockBalanceAfterMinutes: 1100, totalCents: 0 });
    // Already overdrawn before the month: everything is billable.
    expect(computeMonth(block, [e(60)], 1300)).toMatchObject({ includedAvailableMinutes: 0, overageMinutes: 60 });
  });

  it("hourly: every billable minute, rounded per entry", () => {
    // 13→18 + 30 = 48 min at $135/h = $108.
    expect(computeMonth(hourly, [e(13), e(30), e(45, false)])).toMatchObject({ billableMinutes: 48, totalCents: 10800 });
  });

  it("no contract: time is shown but nothing is charged", () => {
    expect(computeMonth(null, [e(90)])).toMatchObject({ billableMinutes: 90, totalCents: 0 });
  });
});

describe("durations", () => {
  it.each([
    ["45", 45], ["45m", 45], ["45 min", 45], ["1h", 60], ["1.5h", 90], ["2 hours", 120], ["1h 30m", 90], ["1h30m", 90], ["1:05", 65],
  ])("%s → %d minutes", (input, minutes) => expect(parseDuration(input)).toBe(minutes));

  it.each(["", "0", "abc", "25h", "1441", "-5", "1:75"])("rejects %s", (input) => expect(parseDuration(input)).toBeNull());

  it("formats", () => {
    expect(formatMinutes(95)).toBe("1h 35m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(20)).toBe("20m");
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(-90)).toBe("-1h 30m");
  });

  it("knows month ends", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02").to).toBe("2028-02-29");
    expect(monthRange("2026-12").to).toBe("2026-12-31");
  });
});
