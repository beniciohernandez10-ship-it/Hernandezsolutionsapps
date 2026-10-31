import { createHmac } from "node:crypto";
import { z } from "zod";
import { safeEqual } from "../crypto";
import { dayKey, endOfDay } from "../dates";
import { db, Prisma } from "../db";
import { mapIndustry } from "../import/industry";
import { findMatch } from "../leads/dedupe";
import { changeStage, recomputeScore, syncNextFollowUp } from "../leads/service";
import { domainFromEmail, isFreeMailDomain, normalizeName, normalizePhone } from "../normalize";
import { isSuppressed } from "../optout";

/**
 * Website inquiries. The website posts each form submission here, signed with
 * a shared secret (lib/leads/process.ts in the website project). A new person
 * becomes a prospect at Interested, with a task to respond today; someone
 * already known is added to their existing record. Redeliveries change nothing.
 * Newsletter signups are ignored: they asked for the newsletter, not a sales call.
 */

const MAX_AGE_SECONDS = 300;

/** The signature covers the timestamp too, so an old request can't be replayed later. */
export function verifySignature(body: string, timestamp: string | null, signature: string | null, secret: string, now = Date.now()): boolean {
  if (!timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_AGE_SECONDS) return false;
  return safeEqual(signature, createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"));
}

const text = (max: number) =>
  z
    .string()
    .nullish()
    .transform((s) => s?.trim().slice(0, max) || null);

export const websitePayload = z.object({
  event: z.literal("lead.created"),
  lead: z.object({
    lead_id: z.string().trim().min(1).max(100),
    type: z.string().trim().min(1).max(40),
    name: text(160),
    company: text(200),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: text(40),
    employee_count: text(40),
    industry: text(120),
    service_interest: z.array(z.string().max(120)).max(30).nullish().transform((v) => v ?? []),
    message: text(5000),
    details: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
    source: text(300),
    campaign: text(200),
    utm_source: text(200),
    utm_medium: text(200),
    utm_campaign: text(200),
    utm_term: text(200),
    utm_content: text(200),
    referrer: text(500),
  }),
});
export type WebsiteLead = z.infer<typeof websitePayload>["lead"];

const TYPE_LABEL: Record<string, string> = {
  consultation: "Consultation request",
  it_review: "IT review request",
  assessment: "Assessment",
  contact: "Contact form",
};

function detailLines(details: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (value === null || value === undefined || value === "") continue;
    lines.push(`${key.replace(/_/g, " ")}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  }
  return lines;
}

export function inquiryBody(lead: WebsiteLead): string {
  const channel = [lead.utm_source, lead.utm_medium, lead.utm_campaign].filter(Boolean).join(" / ");
  return [
    lead.message,
    lead.service_interest.length ? `Interested in: ${lead.service_interest.join(", ")}` : null,
    lead.employee_count ? `Employees: ${lead.employee_count}` : null,
    lead.industry ? `Industry: ${lead.industry}` : null,
    ...detailLines(lead.details),
    lead.source ? `Page: ${lead.source}` : null,
    channel ? `Campaign: ${channel}` : null,
    lead.referrer ? `Came from: ${lead.referrer}` : null,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 8000);
}

export type IngestResult = { outcome: "created" | "merged" | "ignored_newsletter" | "duplicate"; companyId?: string };

/** Stages a returning prospect moves back from. A current client stays where it is. */
const REOPEN_FROM = ["NEW_LEAD", "RESEARCHING", "READY_TO_CONTACT", "ATTEMPTED_CONTACT", "CONTACTED", "FOLLOW_UP_REQUIRED", "CLOSED_LOST", "NOT_INTERESTED", "FUTURE_OPPORTUNITY"];

async function findExisting(lead: WebsiteLead, tx: Prisma.TransactionClient) {
  const byContact = await tx.contact.findFirst({ where: { email: { equals: lead.email, mode: "insensitive" } }, select: { companyId: true } });
  if (byContact) return { id: byContact.companyId, maybeSameAs: null };
  const byInbox = await tx.company.findFirst({ where: { mainEmail: { equals: lead.email, mode: "insensitive" } }, select: { id: true } });
  if (byInbox) return { id: byInbox.id, maybeSameAs: null };
  const emailDomain = domainFromEmail(lead.email);
  const domain = emailDomain && !isFreeMailDomain(emailDomain) ? emailDomain : null;
  // A company email at a domain we already have is that company, even from someone new.
  if (domain) {
    const byDomain = await tx.company.findFirst({ where: { domain }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (byDomain) return { id: byDomain.id, maybeSameAs: null };
  }
  const phone = normalizePhone(lead.phone);
  if (!lead.company && !phone) return { id: null, maybeSameAs: null };
  const normalizedName = lead.company ? normalizeName(lead.company) : "";
  const candidates = await tx.company.findMany({
    where: { OR: [...(normalizedName ? [{ normalizedName }] : []), ...(phone ? [{ normalizedPhone: phone }] : [])] },
    select: { id: true, name: true, normalizedName: true, domain: true, normalizedPhone: true, city: true },
    take: 20,
  });
  const match = findMatch({ normalizedName, domain, normalizedPhone: phone, city: null }, candidates);
  if (match.kind === "same" && match.match) return { id: match.match.id, maybeSameAs: null };
  // Only a look-alike: a person decides, so keep the new record and say so.
  return { id: null, maybeSameAs: match.kind === "ambiguous" ? (match.match?.name ?? null) : null };
}

export async function ingestWebsiteLead(lead: WebsiteLead): Promise<IngestResult> {
  if (lead.type === "newsletter") {
    await db.inboundLead.createMany({ data: [{ leadId: lead.lead_id, type: lead.type, outcome: "ignored_newsletter" }], skipDuplicates: true });
    return { outcome: "ignored_newsletter" };
  }
  try {
    const result = await db.$transaction(async (tx) => {
      const seen = await tx.inboundLead.findUnique({ where: { leadId: lead.lead_id } });
      if (seen) return { outcome: "duplicate" as const, companyId: seen.companyId ?? undefined };

      const owner = await tx.user.findFirst({ where: { active: true, role: "OWNER" }, orderBy: { createdAt: "asc" }, select: { id: true } });
      const existing = await findExisting(lead, tx);
      const emailDomain = domainFromEmail(lead.email);
      const domain = emailDomain && !isFreeMailDomain(emailDomain) ? emailDomain : null;
      const who = lead.name ?? lead.email;
      const typeLabel = TYPE_LABEL[lead.type] ?? "Website inquiry";
      const phone = normalizePhone(lead.phone);
      let companyId: string;

      if (existing.id) {
        companyId = existing.id;
        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { stage: true, archived: true, tags: true } });
        await tx.company.update({
          where: { id: companyId },
          data: { archived: false, tags: Array.from(new Set([...company.tags, "website"])) },
        });
        if (REOPEN_FROM.includes(company.stage)) await changeStage(companyId, "INTERESTED", null, "Reached out through the website", tx);
        const known = await tx.contact.findFirst({ where: { companyId, email: { equals: lead.email, mode: "insensitive" } }, select: { id: true } });
        if (!known) {
          await tx.contact.create({
            data: { companyId, name: lead.name ?? lead.email, email: lead.email, emailStatus: "UNVERIFIED", phone: lead.phone, phoneStatus: lead.phone ? "UNVERIFIED" : "UNKNOWN", preferredContactMethod: "EMAIL", source: "Website" },
          });
        }
      } else {
        const name = lead.company ?? domain ?? `${who} (website inquiry)`;
        const employees = lead.employee_count && /^\d{1,7}$/.test(lead.employee_count) ? Number(lead.employee_count) : null;
        const company = await tx.company.create({
          data: {
            name,
            normalizedName: normalizeName(name),
            industry: mapIndustry(lead.industry).key,
            domain,
            mainPhone: lead.phone,
            normalizedPhone: phone,
            mainPhoneStatus: lead.phone ? "UNVERIFIED" : "UNKNOWN",
            employeeCount: employees,
            employeeCountSource: employees ? "Website form" : null,
            preferredContactMethod: "EMAIL",
            source: `Website: ${typeLabel}`,
            sourceUrl: lead.source,
            priority: "HIGH",
            stage: "INTERESTED",
            tags: ["website"],
            ownerId: owner?.id ?? null,
            notes: existing.maybeSameAs ? `May be the same business as "${existing.maybeSameAs}". Check before contacting.` : null,
            contacts: {
              create: { name: lead.name ?? lead.email, email: lead.email, emailStatus: "UNVERIFIED", phone: lead.phone, phoneStatus: lead.phone ? "UNVERIFIED" : "UNKNOWN", preferredContactMethod: "EMAIL", isPrimary: true, source: "Website" },
            },
          },
          select: { id: true },
        });
        companyId = company.id;
      }

      await tx.activity.create({
        data: {
          companyId,
          type: "WEBSITE_INQUIRY",
          summary: `${typeLabel} from ${who}`,
          body: inquiryBody(lead) || null,
          meta: { leadId: lead.lead_id, type: lead.type, utmSource: lead.utm_source, utmMedium: lead.utm_medium, utmCampaign: lead.utm_campaign },
        },
      });
      // Someone who opted out and then wrote in: a person decides whether to answer by email.
      const optedOut = await isSuppressed(lead.email, tx);
      await tx.task.create({
        data: {
          companyId,
          assigneeId: owner?.id ?? null,
          type: lead.phone ? "CALLBACK" : "EMAIL",
          title: `Respond to ${who}: ${typeLabel.toLowerCase()}`,
          notes: optedOut ? "This address opted out of sales email earlier. They contacted you, but check before emailing." : null,
          // Today, not this instant: a new inquiry shouldn't read as overdue a minute later.
          dueAt: endOfDay(dayKey()),
        },
      });
      await syncNextFollowUp(companyId, tx);
      const outcome = existing.id ? ("merged" as const) : ("created" as const);
      await tx.inboundLead.create({ data: { leadId: lead.lead_id, type: lead.type, outcome, companyId } });
      await tx.auditLog.create({ data: { action: "lead.website", entity: "company", entityId: companyId, meta: { leadId: lead.lead_id, outcome } } });
      return { outcome, companyId };
    });
    // After the commit: scoring reads settings on its own connection, and a failure here shouldn't lose the lead.
    if (result.outcome !== "duplicate" && result.companyId) await recomputeScore(result.companyId).catch(() => undefined);
    return result;
  } catch (err) {
    // Two deliveries at the same moment: the other one recorded it.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { outcome: "duplicate" };
    throw err;
  }
}
