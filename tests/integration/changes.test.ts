import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem, withUser } from "@/lib/db";
import { processJobs } from "@/lib/jobs";
import { createTicket } from "@/lib/tickets/service";
import { listNotifications } from "@/lib/notify/service";
import { changeAction, createChange, decideChange, getChange, linkChangeTicket, listChanges, updateChange } from "@/lib/changes/service";

const U = DEMO.users;
const C = DEMO.customers.contoso;
const F = DEMO.customers.fabrikam;

const inAWeek = new Date(Date.now() + 7 * 86400_000);
const plan = (o: object = {}) => ({
  customerId: C,
  title: "Replace the office firewall",
  description: "Swap the end-of-life firewall for the new one.",
  changeType: "normal",
  risk: "medium",
  impact: "Internet down for about 30 minutes.",
  implementationPlan: "1. Back up config\n2. Swap hardware\n3. Restore config",
  backoutPlan: "Reconnect the old firewall.",
  plannedStart: inAWeek.toISOString(),
  plannedEnd: new Date(inAWeek.getTime() + 3600_000).toISOString(),
  notifyCustomer: true,
  implementerUserId: U.tech,
  ...o,
});

beforeAll(async () => {
  await freshDatabase();
});

describe("change management", () => {
  it("normal changes go to the client admin, who is notified and approves; then it's scheduled", async () => {
    const tech = await principal(U.tech);
    const { id } = await createChange(tech, plan());
    // Drafts are invisible to the customer.
    await expectAppError(getChange(await principal(U.contosoAdmin), id), 404);
    expect((await changeAction(tech, id, { action: "submit" })).status).toBe("pending_approval");
    await processJobs({ limit: 50 });
    const admin = await principal(U.contosoAdmin);
    const n = (await listNotifications(admin)).find((x) => x.changeId === id);
    expect(n?.kind).toBe("change_approval_requested");
    expect(n?.ref).toMatch(/^CHG-\d+$/);
    expect(n?.href).toBe(`/portal/changes/${id}`);
    const seen = await getChange(admin, id);
    expect(seen.viewer.canDecide).toBe(true);
    expect(seen.viewer.actions).toEqual([]);
    await expectAppError(decideChange(await principal(U.contosoRequester), id, { decision: "approved" }), 404);
    await expectAppError(decideChange(await principal(U.fabrikamAdmin), id, { decision: "approved" }), 404);
    await expectAppError(decideChange(tech, id, { decision: "approved" }), 403);
    expect((await decideChange(admin, id, { decision: "approved", note: "Friday evening is fine" })).status).toBe("scheduled");
    await processJobs({ limit: 50 });
    expect((await listNotifications(tech)).some((x) => x.changeId === id && x.kind === "change_decided")).toBe(true);
    expect((await listNotifications(admin)).some((x) => x.changeId === id && x.kind === "change_scheduled")).toBe(false); // the approver isn't told about their own action
    await changeAction(tech, id, { action: "start" });
    await expectAppError(changeAction(tech, id, { action: "complete" }), 422);
    await changeAction(tech, id, { action: "complete", note: "Swapped and tested; all sites online." });
    const done = await getChange(admin, id);
    expect(done.status).toBe("completed");
    expect(done.outcomeNote).toContain("all sites online");
    expect(done.events.map((e) => e.kind)).toEqual(["created", "submitted", "approved", "started", "completed"]);
    await processJobs({ limit: 50 });
    expect((await listNotifications(admin)).some((x) => x.changeId === id && x.kind === "change_finished")).toBe(true);
  });

  it("standard changes are scheduled on submit; emergency ones need a service manager", async () => {
    const tech = await principal(U.tech);
    const std = await createChange(tech, plan({ changeType: "standard", title: "Monthly patching" }));
    expect((await changeAction(tech, std.id, { action: "submit" })).status).toBe("scheduled");
    const em = await createChange(tech, plan({ changeType: "emergency", title: "Patch zero-day" }));
    await changeAction(tech, em.id, { action: "submit" });
    await expectAppError(decideChange(await principal(U.contosoAdmin), em.id, { decision: "approved" }), 403);
    await decideChange(await principal(U.manager), em.id, { decision: "approved" });
    expect((await getChange(tech, em.id)).status).toBe("scheduled");
  });

  it("submitting needs a window and both plans; rejection needs a reason", async () => {
    const tech = await principal(U.tech);
    const bare = await createChange(tech, plan({ plannedStart: null, plannedEnd: null }));
    await expectAppError(changeAction(tech, bare.id, { action: "submit" }), 422);
    const noPlan = await createChange(tech, plan({ backoutPlan: "" }));
    await expectAppError(changeAction(tech, noPlan.id, { action: "submit" }), 422);
    await expectAppError(createChange(tech, plan({ plannedEnd: new Date(inAWeek.getTime() - 1000).toISOString() })), 422);
    const r = await createChange(tech, plan());
    await changeAction(tech, r.id, { action: "submit" });
    const admin = await principal(U.contosoAdmin);
    await expectAppError(decideChange(admin, r.id, { decision: "rejected" }), 422);
    expect((await decideChange(admin, r.id, { decision: "rejected", note: "Not during month-end close" })).status).toBe("rejected");
  });

  it("editing a scheduled change sends it back for approval", async () => {
    const tech = await principal(U.tech);
    const r = await createChange(tech, plan());
    await changeAction(tech, r.id, { action: "submit" });
    await decideChange(await principal(U.contosoAdmin), r.id, { decision: "approved" });
    const out = await updateChange(tech, r.id, plan({ risk: "high" }));
    expect(out.backToDraft).toBe(true);
    expect((await getChange(tech, r.id)).status).toBe("draft");
  });

  it("only staff for the customer create or run changes; lists are scoped", async () => {
    await expectAppError(createChange(await principal(U.techFabrikam), plan()), 403);
    await expectAppError(createChange(await principal(U.contosoAdmin), plan()), 403);
    const r = await createChange(await principal(U.tech), plan({ title: "Scoped change" }));
    expect((await listChanges(await principal(U.techFabrikam))).some((c) => c.id === r.id)).toBe(false);
    expect(await listChanges(await principal(U.contosoRequester))).toEqual([]);
    const direct = await withUser(U.contosoRequester, (tx) => tx.query("select id from change_requests"));
    expect(direct.rows).toHaveLength(0);
    await expectAppError(changeAction(await principal(U.techFabrikam), r.id, { action: "cancel" }), 404);
  });

  it("links tickets of the same customer only", async () => {
    const tech = await principal(U.tech);
    const r = await createChange(tech, plan());
    const t = await createTicket(await principal(U.contosoRequester), { title: "Internet slow", description: "x", priority: "normal", category: "network" }, randomUUID());
    const f = await createTicket(await principal(U.fabrikamRequester), { title: "Other", description: "x", priority: "normal", category: "network" }, randomUUID());
    await linkChangeTicket(tech, r.id, { number: t.number });
    await expectAppError(linkChangeTicket(tech, r.id, { number: f.number }), 422);
    expect((await getChange(tech, r.id)).tickets.map((x) => x.number)).toEqual([t.number]);
    await asSystem((tx) => tx.query("select 1"));
    void F;
  });
});
