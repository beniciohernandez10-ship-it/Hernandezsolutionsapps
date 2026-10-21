import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { withUser } from "@/lib/db";
import { createTicket, getTicket } from "@/lib/tickets/service";
import { getArticle } from "@/lib/kb/service";
import {
  createProblem,
  draftWorkaroundArticle,
  getProblem,
  linkProblemTicket,
  listProblems,
  problemsForCustomer,
  repeatIssues,
  updateProblem,
} from "@/lib/problems/service";

const U = DEMO.users;
const C = DEMO.customers.contoso;
const F = DEMO.customers.fabrikam;
const base = (o: object = {}) => ({ customerId: C, title: "Printer drops off the network", description: "Front desk printer goes offline daily", ...o });
const ticket = async (as: string, title = "Printer offline") =>
  createTicket(await principal(as), { title, description: "Can't print", priority: "normal", category: "hardware" }, randomUUID());

beforeAll(async () => {
  await freshDatabase();
});

describe("problem management", () => {
  it("technicians only; customers can't see problems at all", async () => {
    await expectAppError(createProblem(await principal(U.contosoAdmin), base()), 403);
    await expectAppError(createProblem(await principal(U.techFabrikam), base()), 403);
    const pr = await createProblem(await principal(U.tech), base());
    expect(await listProblems(await principal(U.contosoAdmin))).toEqual([]);
    await expectAppError(getProblem(await principal(U.contosoRequester), pr.id), 404);
    await expectAppError(getProblem(await principal(U.techFabrikam), pr.id), 404);
    const direct = await withUser(U.contosoAdmin, (tx) => tx.query("select id from problems"));
    expect(direct.rows).toHaveLength(0);
  });

  it("links requests of the same customer; known error and resolved need their details", async () => {
    const tech = await principal(U.tech);
    const pr = await createProblem(tech, base());
    const t1 = await ticket(U.contosoRequester);
    const tf = await ticket(U.fabrikamRequester);
    await linkProblemTicket(tech, pr.id, { ticketId: t1.id });
    await expectAppError(linkProblemTicket(await principal(U.techFabrikam), pr.id, { ticketId: tf.id }), 404);
    expect((await getProblem(tech, pr.id)).tickets.map((t) => t.id)).toEqual([t1.id]);
    expect((await getTicket(tech, t1.id)).problem?.id).toBe(pr.id);
    expect((await getTicket(await principal(U.contosoRequester), t1.id)).problem).toBeNull();
    expect((await problemsForCustomer(tech, C)).map((x) => x.id)).toContain(pr.id);

    await expectAppError(updateProblem(tech, pr.id, base({ status: "known_error", rootCause: "DHCP lease conflict" })), 422);
    await updateProblem(tech, pr.id, base({ status: "known_error", rootCause: "DHCP lease conflict", workaround: "Power-cycle the printer." }));
    await expectAppError(updateProblem(tech, pr.id, base({ status: "resolved", rootCause: "x", workaround: "y" })), 422);
    await updateProblem(tech, pr.id, base({ status: "resolved", rootCause: "DHCP lease conflict", workaround: "Power-cycle", permanentFix: "Reserved a static address." }));
    expect((await getProblem(tech, pr.id)).status).toBe("resolved");
  });

  it("drafts a customer article from the workaround, once", async () => {
    const tech = await principal(U.tech);
    const pr = await createProblem(tech, base({ title: "VPN disconnects", status: "known_error", rootCause: "MTU", workaround: "Reconnect from the tray icon." }));
    const a = await draftWorkaroundArticle(tech, pr.id);
    const again = await draftWorkaroundArticle(tech, pr.id);
    expect(again.articleId).toBe(a.articleId);
    const art = await getArticle(tech, a.articleId);
    expect(art.status).toBe("draft");
    expect(art.audience).toBe("customer");
    expect(art.customerId).toBe(C);
    expect(art.body).toContain("Reconnect from the tray icon.");
    const none = await createProblem(tech, base({ title: "No workaround yet" }));
    await expectAppError(draftWorkaroundArticle(tech, none.id), 422);
  });

  it("spots repeat issues not yet tied to a problem", async () => {
    for (let i = 0; i < 3; i++) await ticket(U.contosoRequester2, `Scanner jam ${i}`);
    const r = await repeatIssues(await principal(U.tech));
    const hw = r.find((x) => x.customerId === C && x.category === "hardware");
    expect(hw?.count).toBeGreaterThanOrEqual(3);
    expect(await repeatIssues(await principal(U.contosoAdmin))).toEqual([]);
    void F;
  });
});
