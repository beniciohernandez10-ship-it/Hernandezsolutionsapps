import type { RegionKey } from "./constants";

const LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "l l c", "ltd", "limited", "corp", "corporation", "co", "company", "pc", "pllc",
  "llp", "lp", "plc", "apc", "pa", "the",
]);

/** Lower-case, "&" → "and", punctuation stripped, legal suffixes removed. Used only to find duplicates. */
export function normalizeName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  while (words.length > 1 && words[0] === "the") words.shift();
  return words.join(" ");
}

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "aol.com",
  "icloud.com", "me.com", "mac.com", "comcast.net", "att.net", "sbcglobal.net", "verizon.net", "proton.me", "protonmail.com",
]);

export function isFreeMailDomain(domain: string | null | undefined): boolean {
  return !!domain && FREE_MAIL.has(domain.toLowerCase());
}

/** Host name without "www.", from a URL or a bare domain. Returns null for anything unparseable. */
export function domainFromWebsite(website: string | null | undefined): string | null {
  if (!website) return null;
  const raw = website.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

export function domainFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain.includes(".") ? domain : null;
}

/** Ten-digit US number, or null when it doesn't look like one. */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const main = phone.split(/(?:x|ext\.?|extension)\s*\d+$/i)[0];
  let digits = main.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
}

export function formatPhone(phone: string | null | undefined): string {
  const n = normalizePhone(phone);
  if (!n) return phone ?? "";
  return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
}

/** tel: link target; keeps extensions as a pause. */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const n = normalizePhone(phone);
  const ext = /(?:x|ext\.?|extension)\s*(\d+)$/i.exec(phone)?.[1];
  if (n) return `tel:+1${n}${ext ? `,${ext}` : ""}`;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.length >= 7 ? `tel:${digits}` : null;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function normalizeWebsite(website: string | null | undefined): string | null {
  const domain = domainFromWebsite(website);
  if (!domain) return null;
  const raw = website!.trim();
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

const STATE_NAMES: Record<string, string> = {
  california: "CA", "new york": "NY", texas: "TX", washington: "WA", oregon: "OR", nevada: "NV", arizona: "AZ",
  florida: "FL", illinois: "IL", massachusetts: "MA", colorado: "CO", "new jersey": "NJ", utah: "UT",
};

export function normalizeState(state: string | null | undefined): string | null {
  if (!state) return null;
  const s = state.trim();
  if (/^[a-z]{2}$/i.test(s)) return s.toUpperCase();
  return STATE_NAMES[s.toLowerCase()] ?? s;
}

const CITY_REGION: Record<string, RegionKey> = {
  "san francisco": "san_francisco",
  oakland: "east_bay", berkeley: "east_bay", emeryville: "east_bay", alameda: "east_bay", "walnut creek": "east_bay",
  fremont: "east_bay", hayward: "east_bay", "san leandro": "east_bay", pleasanton: "east_bay", livermore: "east_bay",
  dublin: "east_bay", "san ramon": "east_bay", concord: "east_bay", richmond: "east_bay", danville: "east_bay",
  lafayette: "east_bay", orinda: "east_bay", "castro valley": "east_bay", "union city": "east_bay", newark: "east_bay",
  "san jose": "peninsula_sv", "palo alto": "peninsula_sv", "mountain view": "peninsula_sv", sunnyvale: "peninsula_sv",
  "santa clara": "peninsula_sv", "menlo park": "peninsula_sv", "redwood city": "peninsula_sv", "san mateo": "peninsula_sv",
  "burlingame": "peninsula_sv", "foster city": "peninsula_sv", "south san francisco": "peninsula_sv", cupertino: "peninsula_sv",
  "los gatos": "peninsula_sv", campbell: "peninsula_sv", milpitas: "peninsula_sv", "san carlos": "peninsula_sv",
  belmont: "peninsula_sv", "daly city": "peninsula_sv", "san bruno": "peninsula_sv", "millbrae": "peninsula_sv",
  "los altos": "peninsula_sv", saratoga: "peninsula_sv",
  "los angeles": "los_angeles", hollywood: "los_angeles", "studio city": "los_angeles", "sherman oaks": "los_angeles",
  encino: "los_angeles", burbank: "los_angeles", glendale: "los_angeles", pasadena: "los_angeles", "long beach": "los_angeles",
  torrance: "los_angeles", "el segundo": "los_angeles", "marina del rey": "los_angeles", "playa vista": "los_angeles",
  venice: "los_angeles", "woodland hills": "los_angeles", "van nuys": "los_angeles", "north hollywood": "los_angeles",
  "manhattan beach": "los_angeles", "redondo beach": "los_angeles", "hermosa beach": "los_angeles", inglewood: "los_angeles",
  "century city": "los_angeles", westwood: "los_angeles", "downtown los angeles": "los_angeles",
  "beverly hills": "beverly_hills",
  "west hollywood": "west_hollywood",
  "santa monica": "santa_monica",
  "culver city": "culver_city",
  irvine: "orange_county", "newport beach": "orange_county", "costa mesa": "orange_county", "santa ana": "orange_county",
  anaheim: "orange_county", "huntington beach": "orange_county", "tustin": "orange_county", orange: "orange_county",
  fullerton: "orange_county", "lake forest": "orange_county", "mission viejo": "orange_county", "laguna beach": "orange_county",
  "laguna hills": "orange_county", "laguna niguel": "orange_county", "aliso viejo": "orange_county", "san clemente": "orange_county",
  "fountain valley": "orange_county", "garden grove": "orange_county", "yorba linda": "orange_county", "brea": "orange_county",
  "rancho santa margarita": "orange_county", "dana point": "orange_county", "seal beach": "orange_county", "foothill ranch": "orange_county",
  riverside: "inland_empire", "san bernardino": "inland_empire", ontario: "inland_empire", "rancho cucamonga": "inland_empire",
  corona: "inland_empire", temecula: "inland_empire", murrieta: "inland_empire", fontana: "inland_empire", redlands: "inland_empire",
  "moreno valley": "inland_empire", chino: "inland_empire", "chino hills": "inland_empire", upland: "inland_empire",
  sacramento: "sacramento", roseville: "sacramento", "elk grove": "sacramento", folsom: "sacramento", "rancho cordova": "sacramento",
  davis: "sacramento",
  "san diego": "san_diego", "la jolla": "san_diego", carlsbad: "san_diego", oceanside: "san_diego", escondido: "san_diego",
  "chula vista": "san_diego", encinitas: "san_diego", "del mar": "san_diego", "solana beach": "san_diego",
};

/** Region for a city/state. Unknown California cities fall to "Other California"; other states to "Out of State". */
export function regionFor(city: string | null | undefined, state: string | null | undefined): RegionKey | null {
  const c = city?.trim().toLowerCase();
  const s = normalizeState(state);
  if (c && CITY_REGION[c] && (!s || s === "CA")) return CITY_REGION[c];
  if (s && s !== "CA") return "out_of_state";
  if (s === "CA") return "other_california";
  return null;
}

/** Token-set similarity between two normalized names, 0–1. */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = new Set(a.split(" "));
  const tb = new Set(b.split(" "));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}
