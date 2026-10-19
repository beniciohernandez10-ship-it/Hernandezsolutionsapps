import { describe, expect, it } from "vitest";
import { stageAfterCall } from "@/lib/calls";
import { csvCell, toCsv } from "@/lib/csv";
import { autoMap } from "@/lib/import/mapping";
import { mapIndustry } from "@/lib/import/industry";
import { normalizeRecord, parseVerification } from "@/lib/import/normalize-row";
import { compareCompanies, findMatch } from "@/lib/leads/dedupe";
import { monthlyValue, pipelineTotals, weightedValue } from "@/lib/money";
import { normalizeEmail, normalizePhone, normalizeWebsite } from "@/lib/normalize";
import { rankCandidates, type QueueCandidate } from "@/lib/queue";
import { normalizeUrl as normalize, validate } from "@/lib/research";
import { computeScore } from "@/lib/scoring";
import { BUILT_IN_TEMPLATES, renderTemplate, unresolvedPlaceholders } from "@/lib/templates";

describe("money", () => {
  it("uses $65 per user unless a custom value is set", () => {
    expect(monthlyValue({ managedUsers: 12, stage: "INTERESTED" })).toBe(780);
    expect(monthlyValue({ managedUsers: 12, monthlyValueOverride: "1000", stage: "INTERESTED" })).toBe(1000);
  });
  it("weights first-year value by stage probability", () => {
    expect(weightedValue({ managedUsers: 10, implementationFee: 1200, stage: "PROPOSAL_SENT" })).toBe(((650 * 12 + 1200) * 50) / 100);
  });
  it("leaves closed deals out of pipeline estimates", () => {
    const t = pipelineTotals([
      { managedUsers: 10, stage: "INTERESTED" },
      { managedUsers: 50, stage: "CLOSED_WON" },
      { managedUsers: 50, stage: "CLOSED_LOST" },
    ]);
    expect(t.openDeals).toBe(1);
    expect(t.potentialMrr).toBe(650);
  });
});

describe("dedupe", () => {
  const base = { normalizedName: "acme dental", domain: "acmedental.com", normalizedPhone: "9495550100", city: "Irvine" };
  it("merges only on two agreeing signals", () => {
    expect(compareCompanies(base, { ...base, normalizedPhone: null }).kind).toBe("same");
  });
  it("sends a same-name business in another city to review", () => {
    expect(compareCompanies(base, { normalizedName: "acme dental", domain: null, normalizedPhone: null, city: "Fresno" }).kind).toBe("ambiguous");
  });
  it("never matches on a free mail domain alone", () => {
    expect(compareCompanies({ ...base, normalizedName: "a", domain: "gmail.com", normalizedPhone: null }, { ...base, normalizedName: "b", domain: "gmail.com", normalizedPhone: null }).kind).toBe("none");
  });
  it("prefers a sure match over an ambiguous one", () => {
    const r = findMatch(base, [{ id: "x", ...base, city: "Fresno", domain: null, normalizedPhone: null }, { id: "y", ...base }]);
    expect(r.kind).toBe("same");
    expect(r.match?.id).toBe("y");
  });
});

describe("call outcomes", () => {
  it("only moves leads forward", () => {
    expect(stageAfterCall("NEW_LEAD", "NO_ANSWER")).toBe("ATTEMPTED_CONTACT");
    expect(stageAfterCall("PROPOSAL_SENT", "NO_ANSWER")).toBeNull();
    expect(stageAfterCall("READY_TO_CONTACT", "MEETING_SCHEDULED")).toBe("DISCOVERY_SCHEDULED");
  });
  it("never reopens a closed deal", () => {
    expect(stageAfterCall("CLOSED_WON", "INTERESTED")).toBeNull();
  });
});

describe("call queue ranking", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const end = new Date("2026-10-16T06:59:59Z");
  const c = (id: string, over: Partial<QueueCandidate> = {}): QueueCandidate => ({
    id, priority: "MEDIUM", score: 50, callCount: 0, lastContactedAt: null, nextFollowUpAt: null,
    discoveredAt: now, stage: "READY_TO_CONTACT", callbackDueAt: null, ...over,
  });
  it("puts callbacks, then follow-ups, then priority first", () => {
    const order = rankCandidates([
      c("low", { priority: "LOW" }),
      c("high", { priority: "HIGH" }),
      c("follow", { nextFollowUpAt: now }),
      c("callback", { callbackDueAt: now }),
    ], end).map((r) => r.id);
    expect(order).toEqual(["callback", "follow", "high", "low"]);
  });
  it("prefers fewer attempts and higher scores within a priority", () => {
    const order = rankCandidates([c("tried", { callCount: 2 }), c("weak", { score: 10 }), c("strong", { score: 90 })], end).map((r) => r.id);
    expect(order).toEqual(["strong", "weak", "tried"]);
  });
});

describe("scoring", () => {
  it("adds up to at most 100 and marks estimates", () => {
    const r = computeScore({ industry: "cpa", employeeCount: 30, contacts: [] });
    expect(r.total).toBeGreaterThan(0);
    expect(r.total).toBeLessThanOrEqual(100);
    expect(r.isEstimate).toBe(true);
    expect(r.factors.every((f) => f.points <= f.max)).toBe(true);
  });
  it("gives no Microsoft points without evidence", () => {
    const r = computeScore({ industry: "cpa", contacts: [] });
    expect(r.factors.find((f) => f.key === "microsoft_fit")?.points).toBe(0);
  });
});

describe("import normalization", () => {
  it("cleans contact details", () => {
    expect(normalizeEmail(" Info@Example.COM ")).toBe("info@example.com");
    expect(normalizePhone("(949) 555-0100")).toBe("9495550100");
    expect(normalizeWebsite("www.example.com/")).toMatch(/^https:\/\/(www\.)?example\.com\/?$/);
  });
  it("never treats an unlabeled value as verified", () => {
    expect(parseVerification(null, true)).toBe("UNVERIFIED");
    expect(parseVerification("Verified", true)).toBe("VERIFIED");
    expect(parseVerification("verified", false)).toBe("UNKNOWN");
  });
  it("maps industries and keeps unknowns as other", () => {
    expect(mapIndustry("Veterinary Hospital").key).toBe("veterinary");
    expect(mapIndustry("")).toEqual({ key: "other", matched: false });
  });
  it("reads a row without inventing missing values", () => {
    const headers = ["Company name", "Industry", "Location", "Emails", "Phone"];
    const row = normalizeRecord({ "Company name": "Acme Dental", Industry: "Dental", Location: "Irvine, CA", Emails: "", Phone: "" }, autoMap(headers), 2);
    expect("skip" in row).toBe(false);
    if ("skip" in row) return;
    expect(row.name).toBe("Acme Dental");
    expect(row.mainEmail).toBeNull();
    expect(row.mainPhone).toBeNull();
    expect(row.employeeCount).toBeNull();
    expect(row.stage).toBe("NEW_LEAD");
  });
});

describe("templates", () => {
  it("fills fields and drops a blank personal note line", () => {
    const out = renderTemplate("Hi {{firstName}},\n\n{{personalNote}}\n\nAbout {{companyName}}.", { companyName: "Acme" });
    expect(out).toBe("Hi there,\n\nAbout Acme.");
  });
  it("blocks sending while notes or unknown fields remain", () => {
    expect(unresolvedPlaceholders("Hi {{companyName}} [[check name]]")).toHaveLength(2);
    expect(unresolvedPlaceholders("All set")).toHaveLength(0);
  });
  it("built-in emails don't assume Microsoft or poor security", () => {
    for (const t of BUILT_IN_TEMPLATES.filter((x) => x.channel === "EMAIL")) {
      expect(t.body).not.toMatch(/your (poor|weak|bad) security|you('re| are) (not secure|vulnerable)/i);
      expect(t.body).not.toMatch(/since you use Microsoft|your Microsoft 365 tenant/i);
    }
  });
});

describe("csv", () => {
  it("escapes quotes and blocks spreadsheet formulas", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(toCsv(["a"], [[null]])).toBe("a\r\n\r\n");
  });
});

describe("research validation", () => {
  it("drops findings whose source wasn't seen", () => {
    const r = validate(
      { findings: [
        { field: "employeeCount", value: "25", source_url: "https://example.com/about" },
        { field: "employeeCount", value: "40", source_url: "https://made-up.example/page" },
        { field: "not_a_field", value: "x", source_url: "https://example.com/about" },
      ] },
      new Set([normalize("https://example.com/about")]),
    );
    expect(r.findings).toHaveLength(1);
    expect(r.discarded).toBe(2);
  });
});
