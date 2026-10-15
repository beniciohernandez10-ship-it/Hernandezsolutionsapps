import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";
import { hasRole } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { runResearch, researchConfigured } from "@/lib/research";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || (user.mfaEnabled && !user.mfaVerified) || !hasRole(user.role, "SALES")) return Response.json({ error: "Not allowed" }, { status: 403 });
  if (!user.mfaEnabled && (await getSetting("security")).requireMfa) return Response.json({ error: "Set up two-step sign-in first." }, { status: 403 });
  if (request.headers.get("origin") && new URL(request.headers.get("origin")!).host !== request.headers.get("host")) {
    return Response.json({ error: "Bad origin" }, { status: 403 });
  }
  if (!researchConfigured()) return Response.json({ error: "The research assistant isn't configured." }, { status: 400 });
  if (!(await rateLimit(`research:${user.id}`, 30, 3600))) return Response.json({ error: "Research limit reached for this hour." }, { status: 429 });

  const { id } = await params;
  const company = await db.company.findUnique({ where: { id }, include: { contacts: { select: { name: true, title: true } } } });
  if (!company) return Response.json({ error: "Not found" }, { status: 404 });

  try {
    const result = await runResearch({
      name: company.name,
      website: company.website,
      city: company.city,
      state: company.state,
      industry: company.industry,
      subindustry: company.subindustry,
      notes: company.notes,
      knownContacts: company.contacts.map((c) => [c.name, c.title].filter(Boolean).join(" — ")),
    });
    if (result.findings.length) {
      await db.researchFinding.createMany({
        data: result.findings.map((f) => ({ companyId: id, field: f.field, value: f.value, sourceUrl: f.sourceUrl, sourceTitle: f.sourceTitle, quote: f.quote, createdById: user.id })),
      });
    }
    await db.activity.create({
      data: { companyId: id, userId: user.id, type: "RESEARCH", summary: `Research assistant: ${result.findings.length} sourced finding${result.findings.length === 1 ? "" : "s"} to review`, body: result.summary, meta: { discarded: result.discarded } },
    });
    await audit(user.id, "research.run", { type: "company", id }, { findings: result.findings.length, discarded: result.discarded });
    return Response.json({ ok: true, found: result.findings.length, discarded: result.discarded, summary: result.summary });
  } catch (err) {
    console.error("[research]", err);
    return Response.json({ error: err instanceof Error ? err.message : "Research failed." }, { status: 502 });
  }
}
