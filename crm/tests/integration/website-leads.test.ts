import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/inbound/website-lead/route";
import { db } from "@/lib/db";
import { ingestWebsiteLead, verifySignature, websitePayload } from "@/lib/inbound/website";
import { makeProspect, makeUser, resetDatabase } from "./helpers";

const SECRET = "test-website-secret";
const lead = (over: Record<string, unknown> = {}) => ({
  lead_id: randomUUID(),
  type: "consultation",
  name: "Dana Diaz",
  company: "Bright Smiles Dental",
  email: "dana@brightsmiles.example",
  phone: "(510) 555-0142",
  employee_count: "12",
  industry: "Private healthcare",
  service_interest: ["Managed IT"],
  message: "Our network keeps dropping.",
  details: { urgency: "this month" },
  source: "/services/managed-it",
  campaign: null,
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "bay-area",
  utm_term: null,
  utm_content: null,
  referrer: "https://www.google.com/",
  consent: true,
  consent_version: "2026-09-27",
  status: "new",
  created_at: new Date().toISOString(),
  ...over,
});
const parsed = (over: Record<string, unknown> = {}) => websitePayload.parse({ event: "lead.created", lead: lead(over) }).lead;

function signedRequest(body: string, secret = SECRET, ts = Math.floor(Date.now() / 1000).toString()) {
  return new Request("http://localhost/api/inbound/website-lead", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "x-timestamp": ts, "x-signature": createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex") },
  });
}

beforeEach(async () => {
  await resetDatabase();
  process.env.WEBSITE_LEAD_SECRET = SECRET;
});
afterAll(() => {
  delete process.env.WEBSITE_LEAD_SECRET;
});

describe("signature", () => {
  const now = 1_800_000_000_000;
  const ts = String(now / 1000);
  const sig = (body: string, t = ts) => createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");

  it("accepts the website's format and refuses changes, old requests and wrong secrets", () => {
    expect(verifySignature("{}", ts, sig("{}"), SECRET, now)).toBe(true);
    expect(verifySignature("{ }", ts, sig("{}"), SECRET, now)).toBe(false);
    expect(verifySignature("{}", ts, sig("{}"), "other", now)).toBe(false);
    const old = String(now / 1000 - 600);
    expect(verifySignature("{}", old, sig("{}", old), SECRET, now)).toBe(false);
    expect(verifySignature("{}", null, sig("{}"), SECRET, now)).toBe(false);
    expect(verifySignature("{}", ts, null, SECRET, now)).toBe(false);
    expect(verifySignature("{}", "not-a-time", sig("{}"), SECRET, now)).toBe(false);
  });
});

describe("the endpoint", () => {
  const body = () => JSON.stringify({ event: "lead.created", lead: lead() });

  it("records a signed lead", async () => {
    const res = await POST(signedRequest(body()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "created" });
    expect(await db.company.count()).toBe(1);
  });

  it("checks the signature before anything else, and writes nothing without it", async () => {
    expect((await POST(signedRequest(body(), "wrong-secret"))).status).toBe(401);
    expect((await POST(signedRequest("not json", "wrong-secret"))).status).toBe(401);
    expect((await POST(new Request("http://localhost/x", { method: "POST", body: body() }))).status).toBe(401);
    expect(await db.company.count()).toBe(0);
  });

  it("refuses bad content and a setup with no secret", async () => {
    expect((await POST(signedRequest("not json"))).status).toBe(400);
    expect((await POST(signedRequest(JSON.stringify({ event: "lead.created", lead: { ...lead(), email: "nope" } })))).status).toBe(422);
    expect((await POST(signedRequest(JSON.stringify({ event: "other", lead: lead() })))).status).toBe(422);
    delete process.env.WEBSITE_LEAD_SECRET;
    expect((await POST(signedRequest(body()))).status).toBe(503);
  });
});

describe("new inquiries", () => {
  it("become a high-priority prospect at Interested, with what they said and a task for today", async () => {
    const owner = await makeUser();
    const r = await ingestWebsiteLead(parsed());
    expect(r.outcome).toBe("created");
    const c = await db.company.findUniqueOrThrow({ where: { id: r.companyId }, include: { contacts: true, tasks: true, activities: true } });
    expect(c).toMatchObject({ name: "Bright Smiles Dental", stage: "INTERESTED", priority: "HIGH", domain: "brightsmiles.example", ownerId: owner.id, source: "Website: Consultation request", employeeCount: 12 });
    expect(c.tags).toContain("website");
    expect(c.contacts[0]).toMatchObject({ email: "dana@brightsmiles.example", isPrimary: true, emailStatus: "UNVERIFIED" });
    expect(c.tasks[0]).toMatchObject({ type: "CALLBACK", assigneeId: owner.id, title: "Respond to Dana Diaz: consultation request" });
    expect(c.nextFollowUpAt).not.toBeNull();
    // Due today, so it doesn't read as overdue moments after it arrives.
    expect(c.tasks[0].dueAt.getTime()).toBeGreaterThan(Date.now());
    const a = c.activities.find((x) => x.type === "WEBSITE_INQUIRY")!;
    expect(a.body).toContain("Our network keeps dropping.");
    expect(a.body).toContain("Interested in: Managed IT");
    expect(a.body).toContain("urgency: this month");
    expect(a.body).toContain("Campaign: google / cpc / bay-area");
  });

  it("never invents a company name, and a free-mail domain isn't a company's", async () => {
    const r = await ingestWebsiteLead(parsed({ company: null, email: "dana@gmail.com", phone: null, employee_count: "11-25" }));
    const c = await db.company.findUniqueOrThrow({ where: { id: r.companyId }, include: { tasks: true } });
    expect(c.name).toBe("Dana Diaz (website inquiry)");
    expect(c.domain).toBeNull();
    expect(c.employeeCount).toBeNull();
    expect(c.tasks[0].type).toBe("EMAIL");
  });

  it("are recorded once however often the website redelivers them", async () => {
    const l = parsed();
    expect((await ingestWebsiteLead(l)).outcome).toBe("created");
    expect((await ingestWebsiteLead(l)).outcome).toBe("duplicate");
    expect(await db.company.count()).toBe(1);
    expect(await db.task.count()).toBe(1);
    expect(await db.activity.count({ where: { type: "WEBSITE_INQUIRY" } })).toBe(1);
  });

  it("ignore newsletter signups: they didn't ask for a sales call", async () => {
    const r = await ingestWebsiteLead(parsed({ type: "newsletter" }));
    expect(r.outcome).toBe("ignored_newsletter");
    expect(await db.company.count()).toBe(0);
    expect(await db.contact.count()).toBe(0);
  });
});

describe("people already in the CRM", () => {
  it("are added to their existing record, by email or by company domain", async () => {
    const byEmail = await makeProspect({ name: "Known Co", email: "dana@brightsmiles.example" });
    const r1 = await ingestWebsiteLead(parsed({ company: "Some Other Name" }));
    expect(r1).toMatchObject({ outcome: "merged", companyId: byEmail.id });
    expect(await db.contact.count({ where: { companyId: byEmail.id } })).toBe(1);

    const byDomain = await makeProspect({ name: "Harbor Vet", domain: "harborvet.example" });
    const r2 = await ingestWebsiteLead(parsed({ email: "new.person@harborvet.example", name: "New Person", company: "Harbor Vet Clinic" }));
    expect(r2).toMatchObject({ outcome: "merged", companyId: byDomain.id });
    expect(await db.contact.count({ where: { companyId: byDomain.id, email: "new.person@harborvet.example" } })).toBe(1);
  });

  it("come back from lost or archived, but a won client's stage is left alone", async () => {
    const lost = await makeProspect({ name: "Gone Co", email: "a@gone.example", stage: "CLOSED_LOST" });
    await db.company.update({ where: { id: lost.id }, data: { archived: true } });
    await ingestWebsiteLead(parsed({ email: "a@gone.example" }));
    expect(await db.company.findUniqueOrThrow({ where: { id: lost.id } })).toMatchObject({ stage: "INTERESTED", archived: false });

    const won = await makeProspect({ name: "Won Co", email: "b@won.example", stage: "CLOSED_WON" });
    await ingestWebsiteLead(parsed({ email: "b@won.example" }));
    expect((await db.company.findUniqueOrThrow({ where: { id: won.id } })).stage).toBe("CLOSED_WON");
    expect(await db.task.count({ where: { companyId: won.id } })).toBe(1);
  });

  it("a same-named business with nothing else in common stays separate, flagged for a person", async () => {
    await makeProspect({ name: "bright smiles dental" });
    const r = await ingestWebsiteLead(parsed({ phone: null }));
    expect(r.outcome).toBe("created");
    expect((await db.company.findUniqueOrThrow({ where: { id: r.companyId } })).notes).toContain("May be the same business");
  });

  it("someone who opted out and then wrote in stays opted out, with a warning on the task", async () => {
    await db.emailSuppression.create({ data: { email: "dana@brightsmiles.example", reason: "unsubscribe" } });
    const r = await ingestWebsiteLead(parsed());
    const task = await db.task.findFirstOrThrow({ where: { companyId: r.companyId } });
    expect(task.notes).toContain("opted out");
    expect(await db.emailSuppression.count()).toBe(1);
  });
});
