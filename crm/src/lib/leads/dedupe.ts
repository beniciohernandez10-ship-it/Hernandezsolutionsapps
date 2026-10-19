import { isFreeMailDomain, nameSimilarity } from "../normalize";

export interface DedupeKey {
  id?: string;
  normalizedName: string;
  domain: string | null;
  normalizedPhone: string | null;
  city: string | null;
  zip?: string | null;
  streetAddress?: string | null;
}

export type MatchKind = "same" | "ambiguous" | "none";

export interface MatchResult {
  kind: MatchKind;
  reasons: string[];
}

const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Decide whether an incoming record is the same business as an existing one.
 * "same" requires two independent signals that agree (so look-alike names never merge on their own);
 * a single shared signal, or signals that disagree, is "ambiguous" and goes to manual review.
 */
export function compareCompanies(a: DedupeKey, b: DedupeKey): MatchResult {
  const reasons: string[] = [];
  const sameName = a.normalizedName === b.normalizedName;
  const similarName = !sameName && nameSimilarity(a.normalizedName, b.normalizedName) >= 0.75;
  const sharedDomain = !!a.domain && a.domain === b.domain && !isFreeMailDomain(a.domain);
  const samePhone = !!a.normalizedPhone && a.normalizedPhone === b.normalizedPhone;
  const bothCities = !!lc(a.city) && !!lc(b.city);
  const sameCity = bothCities && lc(a.city) === lc(b.city);
  const differentCity = bothCities && !sameCity;
  const sameStreet = !!lc(a.streetAddress) && lc(a.streetAddress) === lc(b.streetAddress);

  if (sameName) reasons.push("same company name");
  else if (similarName) reasons.push("similar company name");
  if (sharedDomain) reasons.push(`same website domain (${a.domain})`);
  if (samePhone) reasons.push("same phone number");
  if (sameCity) reasons.push("same city");
  if (differentCity) reasons.push(`different city (${a.city} vs ${b.city})`);
  if (sameStreet) reasons.push("same street address");

  if (!sameName && !similarName && !sharedDomain && !samePhone) return { kind: "none", reasons: [] };

  // Strong combinations: same business, same place.
  if (sameName && sharedDomain && !differentCity) return { kind: "same", reasons };
  if (sameName && samePhone) return { kind: "same", reasons };
  if (sameName && sameCity && (sameStreet || !a.streetAddress || !b.streetAddress)) return { kind: "same", reasons };
  if (sharedDomain && samePhone) return { kind: "same", reasons };

  // Shared name with nothing else in common, a different city, or a shared domain with a different name
  // could be a second location or an unrelated business: a person decides.
  if (sameName || sharedDomain || samePhone || (similarName && sameCity)) {
    if (sameName && !bothCities && !sharedDomain && !samePhone) reasons.push("location unknown");
    return { kind: "ambiguous", reasons };
  }
  return { kind: "none", reasons: [] };
}

/** Best match among existing records: any "same" wins, then the first "ambiguous". */
export function findMatch<T extends DedupeKey>(candidate: DedupeKey, existing: T[]): { kind: MatchKind; match?: T; reasons: string[] } {
  let ambiguous: { match: T; reasons: string[] } | null = null;
  for (const e of existing) {
    const r = compareCompanies(candidate, e);
    if (r.kind === "same") return { kind: "same", match: e, reasons: r.reasons };
    if (r.kind === "ambiguous" && !ambiguous) ambiguous = { match: e, reasons: r.reasons };
  }
  return ambiguous ? { kind: "ambiguous", ...ambiguous } : { kind: "none", reasons: [] };
}
