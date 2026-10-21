import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem, withUser } from "@/lib/db";
import { processJobs } from "@/lib/jobs";
import { getTicket, updateTicket } from "@/lib/tickets/service";
import { listNotifications } from "@/lib/notify/service";
import {
  addTask,
  decideApproval,
  getCatalogItem,
  listCatalog,
  listCatalogForOperator,
  pendingApprovals,
  saveCatalogItem,
  setTaskDone,
  submitRequest,
} from "@/lib/catalog/service";

const U = DEMO.users;
const C = DEMO.customers.contoso;
const F = DEMO.customers.fabrikam;

let onboarding: string;
let password: string;

beforeAll(async () => {
  await freshDatabase();
  const items = await listCatalog(await principal(U.contosoRequester));
  onboarding = items.find((i) => i.name === "New employee setup")!.id;
  password = items.find((i) => i.name.startsWith("Password reset"))!.id;
});

const onboardingAnswers = { full_name: "Jordan Lee", start_date: "2026-11-02", device: "New laptop", job_title: "Hygienist" };

describe("catalog", () => {
  it("offers the starter items to members, and nothing to people without an organization", async () => {
    const items = await listCatalog(await principal(U.contosoRequester));
    expect(items.map((i) => i.name)).toContain("Employee offboarding");
    expect(await listCatalog(await principal(U.operator))).toEqual([]);
  });

  it("validates answers against the form", async () => {
    const p = await principal(U.contosoRequester);
    const err = await expectAppError(submitRequest(p, onboarding, { answers: { full_name: "" } }, randomUUID()), 422);
    const fields = (err as { details?: { fields?: { path: string }[] } }).details?.fields?.map((f) => f.path) ?? [];
    expect(fields).toEqual(expect.arrayContaining(["answers.full_name", "answers.start_date", "answers.device"]));
    await expectAppError(submitRequest(p, onboarding, { answers: { ...onboardingAnswers, device: "Spaceship" } }, randomUUID()), 422);
    await expectAppError(submitRequest(p, onboarding, { answers: { ...onboardingAnswers, start_date: "next tuesday" } }, randomUUID()), 422);
  });

  it("customer-specific items are invisible to other customers", async () => {
    const op = await principal(U.operator);
    const fields = [{ key: "what", label: "What", type: "text", required: true }];
    const { id } = await saveCatalogItem(op, null, {
      customerId: F, name: "Fabrikam only", summary: "", category: "general", defaultPriority: "normal",
      fields, tasks: [], requiresApproval: false, active: true, sortOrder: 5,
    });
    expect((await listCatalog(await principal(U.fabrikamRequester))).some((i) => i.id === id)).toBe(true);
    await expectAppError(getCatalogItem(await principal(U.contosoRequester), id), 404);
    await expectAppError(submitRequest(await principal(U.contosoRequester), id, { answers: { what: "x" } }, randomUUID()), 404);
    await expectAppError(saveCatalogItem(await principal(U.manager), null, {}), 403);
    expect((await listCatalogForOperator(op)).some((i) => i.id === id)).toBe(true);
  });
});

describe("approvals", () => {
  it("a requester's request waits for the client admin, who is notified", async () => {
    const r = await submitRequest(await principal(U.contosoRequester), onboarding, { answers: onboardingAnswers }, randomUUID());
    const t = await getTicket(await principal(U.contosoRequester), r.id);
    expect(t.kind).toBe("request");
    expect(t.title).toBe("New employee setup: Jordan Lee");
    expect(t.approval?.status).toBe("pending");
    expect(t.approval?.canDecide).toBe(false);
    // The requester sees who approves, even though they can't list other members.
    expect(t.approval?.approverLabel).toBe("your organization's administrator");
    expect(t.tasks).toHaveLength(0);
    expect(t.requestData?.find((a) => a.label === "Start date")?.value).toBe("2026-11-02");
    await processJobs({ limit: 50 });
    const admin = await principal(U.contosoAdmin);
    expect((await listNotifications(admin)).some((n) => n.ticketId === r.id && n.kind === "approval_requested")).toBe(true);
    expect((await pendingApprovals(admin)).map((a) => a.ticketId)).toContain(r.id);
    // Technicians can't start work yet.
    const tech = await principal(U.tech);
    expect((await getTicket(tech, r.id)).viewer.canChangeStatus).not.toContain("in_progress");
    await expectAppError(updateTicket(tech, r.id, { expectedVersion: (await getTicket(tech, r.id)).version, status: "in_progress" }), 422);
  });

  it("only an approver may decide, and approval creates the checklist", async () => {
    const r = await submitRequest(await principal(U.contosoRequester), onboarding, { answers: onboardingAnswers }, randomUUID());
    await expectAppError(decideApproval(await principal(U.contosoRequester), r.id, { decision: "approved" }), 403);
    await expectAppError(decideApproval(await principal(U.contosoRequester2), r.id, { decision: "approved" }), 404);
    await expectAppError(decideApproval(await principal(U.tech), r.id, { decision: "approved" }), 403);
    await expectAppError(decideApproval(await principal(U.fabrikamAdmin), r.id, { decision: "approved" }), 404);
    // Direct database writes are refused for non-approvers too.
    const direct = await withUser(U.contosoRequester, (tx) =>
      tx.query("update approvals set status = 'approved', decided_by = $2 where ticket_id = $1", [r.id, U.contosoRequester]),
    );
    expect(direct.rowCount).toBe(0);
    await decideApproval(await principal(U.contosoAdmin), r.id, { decision: "approved" });
    const t = await getTicket(await principal(U.tech), r.id);
    expect(t.approval?.status).toBe("approved");
    expect(t.approvalStatus).toBe("approved");
    expect(t.tasks.map((x) => x.title)[0]).toBe("Create the Microsoft 365 account");
    await expectAppError(decideApproval(await principal(U.contosoAdmin), r.id, { decision: "rejected", note: "late" }), 409);
    await processJobs({ limit: 50 });
    expect((await listNotifications(await principal(U.contosoRequester))).some((n) => n.ticketId === r.id && n.kind === "approval_decided")).toBe(true);
  });

  it("rejection needs a reason, closes the request and tells the requester why", async () => {
    const r = await submitRequest(await principal(U.contosoRequester), onboarding, { answers: onboardingAnswers }, randomUUID());
    const admin = await principal(U.contosoAdmin);
    await expectAppError(decideApproval(admin, r.id, { decision: "rejected" }), 422);
    await decideApproval(admin, r.id, { decision: "rejected", note: "Position was cancelled." });
    const t = await getTicket(await principal(U.contosoRequester), r.id);
    expect(t.status).toBe("resolved");
    expect(t.approvalStatus).toBe("rejected");
    expect(t.messages.at(-1)?.body).toBe("Not approved: Position was cancelled.");
    expect(t.tasks).toHaveLength(0);
  });

  it("an approver's own request is approved on submission", async () => {
    const r = await submitRequest(await principal(U.contosoAdmin), onboarding, { answers: onboardingAnswers }, randomUUID());
    const t = await getTicket(await principal(U.contosoAdmin), r.id);
    expect(t.approval?.status).toBe("approved");
    expect(t.tasks.length).toBeGreaterThan(0);
  });

  it("items without approval get their checklist immediately", async () => {
    const r = await submitRequest(await principal(U.contosoRequester), password, { answers: { account: "riley", callback: "555-0100" } }, randomUUID());
    const t = await getTicket(await principal(U.tech), r.id);
    expect(t.approvalStatus).toBe("not_required");
    expect(t.priority).toBe("high");
    expect(t.tasks).toHaveLength(3);
  });

  it("with no client admin, a service manager approves", async () => {
    await asSystem((tx) => tx.query("update memberships set revoked_at = now() where user_id = $1", [U.fabrikamAdmin]));
    try {
      const items = await listCatalog(await principal(U.fabrikamRequester));
      const sw = items.find((i) => i.name === "Software request")!;
      const r = await submitRequest(await principal(U.fabrikamRequester), sw.id, { answers: { software: "Adobe Acrobat", users: "Front desk", reason: "PDF forms", licensing: "We need a quote" } }, randomUUID());
      const t = await getTicket(await principal(U.manager), r.id);
      expect(t.approval?.canDecide).toBe(true);
      expect(t.approval?.approverLabel).toBe("Hernandez Solutions");
      await expectAppError(decideApproval(await principal(U.techFabrikam), r.id, { decision: "approved" }), 403);
      await decideApproval(await principal(U.manager), r.id, { decision: "approved" });
    } finally {
      await asSystem((tx) => tx.query("update memberships set revoked_at = null where user_id = $1", [U.fabrikamAdmin]));
    }
  });
});

describe("fulfilment checklist", () => {
  it("staff tick tasks off; customers can only read them", async () => {
    const r = await submitRequest(await principal(U.contosoRequester), password, { answers: { account: "riley", callback: "555-0100" } }, randomUUID());
    const tech = await principal(U.tech);
    const [first] = (await getTicket(tech, r.id)).tasks;
    await setTaskDone(tech, r.id, first.id, true);
    await addTask(tech, r.id, { title: "Tell the manager" });
    const seen = await getTicket(await principal(U.contosoRequester), r.id);
    expect(seen.tasks.find((x) => x.id === first.id)?.done).toBe(true);
    expect(seen.tasks.at(-1)?.title).toBe("Tell the manager");
    await expectAppError(setTaskDone(await principal(U.contosoRequester), r.id, first.id, false), 403);
    await expectAppError(addTask(await principal(U.contosoAdmin), r.id, { title: "x" }), 403);
    await expectAppError(setTaskDone(await principal(U.techFabrikam), r.id, first.id, false), 404);
    const direct = await withUser(U.contosoRequester, (tx) => tx.query("update ticket_tasks set done_at = null where ticket_id = $1", [r.id]));
    expect(direct.rowCount).toBe(0);
  });
});
