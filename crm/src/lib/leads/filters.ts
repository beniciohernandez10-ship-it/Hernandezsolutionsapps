import type { Prisma } from "@/generated/prisma/client";
import { STAGE_KEYS, VETERINARY_INDUSTRY } from "../constants";
import { normalizePhone } from "../normalize";

export type LeadView = "general" | "startups" | "veterinary" | "all";

export interface LeadFilters {
  view: LeadView;
  q?: string;
  industry: string[];
  region: string[];
  stage: string[];
  priority: string[];
  owner?: string;
  tag?: string;
  city?: string;
  state?: string;
  zip?: string;
  scoreMin?: number;
  contact?: "has_email" | "has_phone" | "verified_email" | "verified_phone" | "no_contact" | "needs_verification";
  followUp?: "overdue" | "today" | "week" | "none";
  archived?: boolean;
}

type Params = Record<string, string | string[] | undefined>;

const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(",") : []).map((s) => s.trim()).filter(Boolean);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export function parseLeadFilters(sp: Params): LeadFilters {
  const view = one(sp.view);
  const contact = one(sp.contact);
  const followUp = one(sp.followUp);
  const scoreMin = Number(one(sp.scoreMin));
  return {
    view: view === "startups" || view === "veterinary" || view === "all" ? view : "general",
    q: one(sp.q)?.slice(0, 200),
    industry: list(sp.industry),
    region: list(sp.region),
    stage: list(sp.stage).filter((s) => (STAGE_KEYS as string[]).includes(s)),
    priority: list(sp.priority).filter((p) => ["HIGH", "MEDIUM", "LOW"].includes(p)),
    owner: one(sp.owner),
    tag: one(sp.tag),
    city: one(sp.city),
    state: one(sp.state),
    zip: one(sp.zip),
    scoreMin: Number.isFinite(scoreMin) && scoreMin > 0 ? scoreMin : undefined,
    contact: (["has_email", "has_phone", "verified_email", "verified_phone", "no_contact", "needs_verification"] as const).find((c) => c === contact),
    followUp: (["overdue", "today", "week", "none"] as const).find((f) => f === followUp),
    archived: one(sp.archived) === "1",
  };
}

export function filtersToSearch(f: Partial<LeadFilters>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(","));
    } else if (k === "view" && v === "general") continue;
    else p.set(k, v === true ? "1" : String(v));
  }
  return p.toString();
}

/**
 * Prisma filter for the lead list. The general view leaves veterinary practices out unless
 * the veterinary industry is selected explicitly; startups keep their real industry.
 */
export function leadWhere(f: LeadFilters, now = new Date(), dayBounds?: { start: Date; end: Date; weekEnd: Date }): Prisma.CompanyWhereInput {
  const and: Prisma.CompanyWhereInput[] = [{ archived: f.archived ?? false }];

  if (f.view === "veterinary") and.push({ industry: VETERINARY_INDUSTRY });
  else if (f.view === "startups") and.push({ businessStage: "STARTUP" });
  if (f.view === "general" && !f.industry.includes(VETERINARY_INDUSTRY)) and.push({ industry: { not: VETERINARY_INDUSTRY } });

  if (f.industry.length) and.push({ industry: { in: f.industry } });
  if (f.region.length) and.push({ region: { in: f.region } });
  if (f.stage.length) and.push({ stage: { in: f.stage as never } });
  if (f.priority.length) and.push({ priority: { in: f.priority as never } });
  if (f.owner === "none") and.push({ ownerId: null });
  else if (f.owner) and.push({ ownerId: f.owner });
  if (f.tag) and.push({ tags: { has: f.tag } });
  if (f.city) and.push({ city: { equals: f.city, mode: "insensitive" } });
  if (f.state) and.push({ state: { equals: f.state, mode: "insensitive" } });
  if (f.zip) and.push({ zip: { startsWith: f.zip } });
  if (f.scoreMin) and.push({ score: { gte: f.scoreMin } });

  switch (f.contact) {
    case "has_email":
      and.push({ OR: [{ mainEmail: { not: null } }, { contacts: { some: { email: { not: null } } } }] });
      break;
    case "has_phone":
      and.push({ OR: [{ mainPhone: { not: null } }, { contacts: { some: { phone: { not: null } } } }] });
      break;
    case "verified_email":
      and.push({ OR: [{ mainEmailStatus: "VERIFIED" }, { contacts: { some: { emailStatus: "VERIFIED" } } }] });
      break;
    case "verified_phone":
      and.push({ OR: [{ mainPhoneStatus: "VERIFIED" }, { contacts: { some: { phoneStatus: "VERIFIED" } } }] });
      break;
    case "no_contact":
      and.push({ mainEmail: null, mainPhone: null, contacts: { none: { OR: [{ email: { not: null } }, { phone: { not: null } }] } } });
      break;
    case "needs_verification":
      and.push({
        OR: [
          { mainEmail: { not: null }, mainEmailStatus: { in: ["UNVERIFIED", "UNKNOWN"] } },
          { mainPhone: { not: null }, mainPhoneStatus: { in: ["UNVERIFIED", "UNKNOWN"] } },
          { contacts: { some: { OR: [{ email: { not: null }, emailStatus: { in: ["UNVERIFIED", "UNKNOWN"] } }, { phone: { not: null }, phoneStatus: { in: ["UNVERIFIED", "UNKNOWN"] } }] } } },
        ],
      });
      break;
  }

  if (f.followUp && dayBounds) {
    if (f.followUp === "overdue") and.push({ nextFollowUpAt: { lt: dayBounds.start } });
    if (f.followUp === "today") and.push({ nextFollowUpAt: { gte: dayBounds.start, lt: dayBounds.end } });
    if (f.followUp === "week") and.push({ nextFollowUpAt: { gte: now, lt: dayBounds.weekEnd } });
    if (f.followUp === "none") and.push({ nextFollowUpAt: null });
  }

  if (f.q) {
    const q = f.q;
    const phone = normalizePhone(q);
    const or: Prisma.CompanyWhereInput[] = [
      { name: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { website: { contains: q, mode: "insensitive" } },
      { mainEmail: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
      { tags: { has: q.toLowerCase() } },
      { contacts: { some: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }] } } },
    ];
    if (phone) or.push({ normalizedPhone: phone }, { contacts: { some: { phone: { contains: phone.slice(-4) } } } });
    and.push({ OR: or });
  }
  return { AND: and };
}
