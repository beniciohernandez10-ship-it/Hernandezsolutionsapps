import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem } from "@/lib/db";
import { setConfigForTesting } from "@/lib/config";
import { setResendFetchForTesting } from "@/lib/email/resend";
import { ingestInboundEmail, recordInboundWebhook } from "@/lib/email/inbound";
import { processJobs } from "@/lib/jobs";
import { saveCatalogItem, submitRequest } from "@/lib/catalog/service";
import {
  addDelegation,
  applicableSteps,
  conditionMet,
  decideApproval,
  delegationOptions,
  myApprovalTurn,
  parseEmailDecision,
  pendingApprovals,
  removeDelegation,
  repairApprovals,
} from "@/lib/catalog/workflow";
import { getTicket } from "@/lib/tickets/service";
import { listNotifications } from "@/lib/notify/service";
import { todayPacific } from "@/lib/billing/service";

const U = DEMO.users;
const C = DEMO.customers.contoso;

const fields = [
  { key: "what", label: "What do you need", type: "text", required: true },
  { key: "cost", label: "Cost", type: "text", required: true },
];
const answers = (cost: string) => ({ answers: { what: "A new laptop", cost } });
const dana = { type: "user", userId: U.contosoRequester2 };
const admins = { type: "role", role: "client_admin" };
const managers = { type: "role", role: "service_manager" };

async function item(approvalSteps: object[], name = `Purchase ${randomUUID().slice(0, 8)}`) {
  const { id } = await saveCatalogItem(await principal(U.operator), null, {
    customerId: C, name, summary: "", category: "hardware", defaultPriority: "normal", fields,
    tasks: ["Order it", "Hand it over"], requiresApproval: false, approvalSteps, active: true, sortOrder: 5,
  });
  return id;
}
const ask = async (itemId: string, cost = "100", who: string = U.contosoRequester) => submitRequest(await principal(who), itemId, answers(cost), randomUUID());
const view = async (id: string, who: string = U.manager) => getTicket(await principal(who), id);
const decide = async (id: string, who: string, decision: "approved" | "rejected" = "approved", note?: string) =>
  decideApproval(await principal(who), id, { decision, ...(note ? { note } : {}) });

beforeAll(async () => {
  await freshDatabase();
});

describe("steps", () => {
  it("run in order; the request is approved and gets its checklist only after the last", async () => {
    const id = await item([
      { name: "Office manager", approvers: [dana] },
      { name: "Owner", approvers: [admins] },
    ]);
    const r = await ask(id);
    let t = await view(r.id);
    expect(t.approvalStatus).toBe("pending");
    expect(t.approval?.steps.map((s) => s.state)).toEqual(["current", "upcoming"]);
    expect(t.approval?.approverLabel).toBe("Rowan Reed (Demo)");
    expect(t.tasks).toHaveLength(0);

    // The owner's turn hasn't come, and they're not on this step.
    await expectAppError(decide(r.id, U.contosoAdmin), 403);
    // A named person who is a plain requester can open what they're asked to approve, and is told.
    expect((await view(r.id, U.contosoRequester2)).title).toContain("Purchase");
    expect((await pendingApprovals(await principal(U.contosoRequester2))).map((a) => a.ticketId)).toContain(r.id);
    await processJobs({ limit: 50 });
    expect((await listNotifications(await principal(U.contosoRequester2))).some((n) => n.ticketId === r.id && n.kind === "approval_requested")).toBe(true);

    expect(await decide(r.id, U.contosoRequester2)).toEqual({ approvalStatus: "pending" });
    t = await view(r.id);
    expect(t.approval?.steps.map((s) => s.state)).toEqual(["done", "current"]);
    expect(t.approval?.steps[0].slots[0]).toMatchObject({ status: "approved", decidedBy: "Rowan Reed (Demo)" });

    expect(await decide(r.id, U.contosoAdmin)).toEqual({ approvalStatus: "approved" });
    t = await view(r.id);
    expect(t.approvalStatus).toBe("approved");
    expect(t.tasks.map((x) => x.title)).toEqual(["Order it", "Hand it over"]);
    await expectAppError(decide(r.id, U.contosoAdmin), 409);
  });

  it("a rejection at any step ends the request and cancels what's left", async () => {
    const id = await item([
      { name: "First", approvers: [dana] },
      { name: "Second", approvers: [admins] },
    ]);
    const r = await ask(id);
    await decide(r.id, U.contosoRequester2);
    await expectAppError(decide(r.id, U.contosoAdmin, "rejected"), 422);
    await decide(r.id, U.contosoAdmin, "rejected", "Over budget this quarter.");
    const t = await view(r.id);
    expect(t).toMatchObject({ approvalStatus: "rejected", status: "resolved", resolutionNote: "Not approved: Over budget this quarter." });
    expect(t.approval?.steps[1].state).toBe("rejected");
    expect(t.tasks).toHaveLength(0);
    const left = await asSystem((tx) => tx.query("select 1 from approvals where ticket_id = $1 and status = 'pending'", [r.id]));
    expect(left.rows).toHaveLength(0);
  });

  it("the plan is fixed at submission, so editing the item doesn't change a request in flight", async () => {
    const id = await item([{ name: "Only", approvers: [dana] }]);
    const r = await ask(id);
    await saveCatalogItem(await principal(U.operator), id, {
      customerId: C, name: "Edited", summary: "", category: "hardware", defaultPriority: "normal", fields, tasks: [], requiresApproval: false,
      approvalSteps: [{ name: "A", approvers: [admins] }, { name: "B", approvers: [admins] }], active: true, sortOrder: 5,
    });
    expect((await view(r.id)).approval?.steps.map((s) => s.name)).toEqual(["Only"]);
    expect(await decide(r.id, U.contosoRequester2)).toEqual({ approvalStatus: "approved" });
  });
});

describe("parallel approvers", () => {
  it('"all" waits for every approver', async () => {
    const id = await item([{ name: "Both", mode: "all", approvers: [dana, admins] }]);
    const r = await ask(id);
    expect((await view(r.id)).approval?.approverLabel).toBe("Rowan Reed (Demo) and your organization's administrator");
    expect(await decide(r.id, U.contosoAdmin)).toEqual({ approvalStatus: "pending" });
    // The same person can't fill both slots.
    await expectAppError(decide(r.id, U.contosoAdmin), 403);
    expect(await decide(r.id, U.contosoRequester2)).toEqual({ approvalStatus: "approved" });
  });

  it('"any" finishes at the first approval and retires the others', async () => {
    const id = await item([{ name: "Either", mode: "any", approvers: [dana, admins] }]);
    const r = await ask(id);
    expect((await view(r.id)).approval?.approverLabel).toBe("Rowan Reed (Demo) or your organization's administrator");
    expect(await decide(r.id, U.contosoRequester2)).toEqual({ approvalStatus: "approved" });
    const statuses = await asSystem((tx) => tx.query<{ status: string }>("select status from approvals where ticket_id = $1 order by slot", [r.id]));
    expect(statuses.rows.map((s) => s.status)).toEqual(["approved", "cancelled"]);
  });

  it("service managers can always decide; a slot for managers isn't open to client admins", async () => {
    const id = await item([{ name: "Vendor check", approvers: [managers] }]);
    const r = await ask(id);
    await expectAppError(decide(r.id, U.contosoAdmin), 403);
    expect(await decide(r.id, U.manager)).toEqual({ approvalStatus: "approved" });
  });
});

describe("conditions", () => {
  const big = { field: "Cost", op: "greater_than", value: "1000" };

  it("compare numbers, text and missing answers", () => {
    const a = [{ label: "Cost", value: "$1,500.00" }, { label: "Type", value: "Laptop" }];
    expect(conditionMet(null, a)).toBe(true);
    expect(conditionMet({ field: "cost", op: "greater_than", value: "1000" }, a)).toBe(true);
    expect(conditionMet({ field: "Cost", op: "less_than", value: "1000" }, a)).toBe(false);
    expect(conditionMet({ field: "Type", op: "equals", value: "laptop" }, a)).toBe(true);
    expect(conditionMet({ field: "Type", op: "not_equals", value: "laptop" }, a)).toBe(false);
    expect(conditionMet({ field: "Type", op: "contains", value: "lap" }, a)).toBe(true);
    // Unreadable or missing numbers never satisfy a numeric test.
    expect(conditionMet({ field: "Cost", op: "greater_than", value: "1000" }, [{ label: "Cost", value: "a lot" }])).toBe(false);
    expect(conditionMet({ field: "Nope", op: "less_than", value: "1000" }, a)).toBe(false);
  });

  it("skip steps that don't apply, and need no approval when none do", async () => {
    const id = await item([
      { name: "Manager", approvers: [dana] },
      { name: "Owner for big purchases", approvers: [admins], condition: big },
    ]);
    const small = await ask(id, "200");
    expect((await view(small.id)).approval?.steps.map((s) => s.name)).toEqual(["Manager"]);
    const large = await ask(id, "$2,500");
    expect((await view(large.id)).approval?.steps.map((s) => s.name)).toEqual(["Manager", "Owner for big purchases"]);

    const onlyBig = await item([{ name: "Owner", approvers: [admins], condition: big }]);
    const r = await ask(onlyBig, "50");
    const t = await view(r.id);
    expect(t.approvalStatus).toBe("not_required");
    expect(t.tasks).toHaveLength(2);
  });

  it("must point at a question the form has", async () => {
    await expectAppError(item([{ name: "Owner", approvers: [admins], condition: { field: "Budget", op: "equals", value: "x" } }]), 422);
    expect(applicableSteps({ requiresApproval: true, approvalSteps: [] }, [])).toHaveLength(1);
    expect(applicableSteps({ requiresApproval: false, approvalSteps: [] }, [])).toHaveLength(0);
  });
});

describe("edge cases", () => {
  it("someone who could approve their own request skips that step only", async () => {
    const id = await item([
      { name: "Admins", approvers: [admins] },
      { name: "Rowan", approvers: [dana] },
    ]);
    const r = await ask(id, "100", U.contosoAdmin);
    const t = await view(r.id);
    expect(t.approval?.steps.map((s) => s.state)).toEqual(["done", "current"]);
    expect(t.approval?.steps[0].slots[0].via).toBe("automatic");
  });

  it("a named approver who has left is replaced by the usual approvers", async () => {
    const id = await item([{ name: "Rowan", approvers: [dana] }]);
    await asSystem((tx) => tx.query("update memberships set revoked_at = now() where user_id = $1 and customer_id = $2", [U.contosoRequester2, C]));
    const r = await ask(id);
    await asSystem((tx) => tx.query("update memberships set revoked_at = null where user_id = $1 and customer_id = $2", [U.contosoRequester2, C]));
    expect((await view(r.id)).approval?.approverLabel).toBe("your organization's administrator");
    await expectAppError(decide(r.id, U.contosoRequester2), 404);
    expect(await decide(r.id, U.contosoAdmin)).toEqual({ approvalStatus: "approved" });
  });

  it("a request whose start failed is repaired by the daily job", async () => {
    const id = await item([{ name: "Rowan", approvers: [dana] }]);
    const r = await ask(id);
    await asSystem(async (tx) => {
      await tx.query("delete from approvals where ticket_id = $1", [r.id]);
      await tx.query("update tickets set created_at = now() - interval '1 hour' where id = $1", [r.id]);
    });
    await repairApprovals();
    expect((await view(r.id)).approval?.steps[0].state).toBe("current");
  });
});

describe("delegation", () => {
  const dates = () => {
    const d = todayPacific();
    return { startsOn: d, endsOn: d };
  };

  it("a stand-in sees and decides for someone away, on the record", async () => {
    const admin = await principal(U.contosoAdmin);
    const opts = await delegationOptions(admin);
    expect(opts.canDelegate).toBe(true);
    expect(opts.people.map((x) => x.id)).toContain(U.contosoRequester2);
    const { id: delegationId } = await addDelegation(admin, { delegateUserId: U.contosoRequester2, ...dates() });

    const itemId = await item([{ name: "Owner", approvers: [admins] }]);
    const r = await ask(itemId);
    const sub = await principal(U.contosoRequester2);
    // Plain requester, but standing in: they can open it and it's on their list.
    expect((await view(r.id, U.contosoRequester2)).id).toBe(r.id);
    expect((await pendingApprovals(sub)).map((a) => a.ticketId)).toContain(r.id);
    expect(await myApprovalTurn(sub, r.id)).toMatchObject({ onBehalfOfName: "Cora Chen (Demo)" });
    await processJobs({ limit: 50 });
    expect((await listNotifications(sub)).some((n) => n.ticketId === r.id && n.kind === "approval_requested")).toBe(true);

    expect(await decideApproval(sub, r.id, { decision: "approved" })).toEqual({ approvalStatus: "approved" });
    expect((await view(r.id)).approval?.steps[0].slots[0]).toMatchObject({ decidedBy: "Rowan Reed (Demo)", onBehalfOf: "Cora Chen (Demo)" });
    await removeDelegation(admin, delegationId);
  });

  it("never lets a stand-in approve their own request", async () => {
    const admin = await principal(U.contosoAdmin);
    const { id: delegationId } = await addDelegation(admin, { delegateUserId: U.contosoRequester, ...dates() });
    const r = await ask(await item([{ name: "Owner", approvers: [admins] }]));
    expect(await myApprovalTurn(await principal(U.contosoRequester), r.id)).toBeNull();
    await expectAppError(decide(r.id, U.contosoRequester), 403);
    await removeDelegation(admin, delegationId);
  });

  it("only applies within its dates, ends when removed, and needs someone from your organization", async () => {
    const admin = await principal(U.contosoAdmin);
    const r = await ask(await item([{ name: "Owner", approvers: [admins] }]));
    const { id } = await addDelegation(admin, { delegateUserId: U.contosoRequester2, startsOn: "2030-01-01", endsOn: "2030-01-05" });
    expect(await myApprovalTurn(await principal(U.contosoRequester2), r.id)).toBeNull();
    await removeDelegation(admin, id);
    const { id: now } = await addDelegation(admin, { delegateUserId: U.contosoRequester2, ...dates() });
    await removeDelegation(admin, now);
    await expectAppError(decide(r.id, U.contosoRequester2), 404);

    await expectAppError(addDelegation(admin, { delegateUserId: U.fabrikamRequester, ...dates() }), 422);
    await expectAppError(addDelegation(admin, { delegateUserId: U.contosoRequester2, startsOn: "2030-02-30", endsOn: "2030-03-01" }), 422);
    await expectAppError(addDelegation(admin, { delegateUserId: U.contosoRequester2, startsOn: "2030-03-02", endsOn: "2030-03-01" }), 422);
    await expectAppError(addDelegation(await principal(U.contosoRequester), { delegateUserId: U.contosoRequester2, ...dates() }), 403);
    // Someone else's delegation can't be removed.
    const { id: mine } = await addDelegation(admin, { delegateUserId: U.contosoRequester2, startsOn: "2030-01-01", endsOn: "2030-01-05" });
    await expectAppError(removeDelegation(await principal(U.manager), mine), 404);
    await removeDelegation(admin, mine);
  });
});

describe("approving by email", () => {
  it("reads only clear answers", () => {
    expect(parseEmailDecision("Approve")).toEqual({ decision: "approved" });
    expect(parseEmailDecision("approved.\n\nSent from my iPhone")).toEqual({ decision: "approved" });
    expect(parseEmailDecision("OK")).toEqual({ decision: "approved" });
    expect(parseEmailDecision("Approve: within budget")).toEqual({ decision: "approved", note: "within budget" });
    expect(parseEmailDecision("Reject - over budget")).toEqual({ decision: "rejected", note: "over budget" });
    expect(parseEmailDecision("declined\nWe already have one.")).toEqual({ decision: "rejected", note: "We already have one." });
    expect(parseEmailDecision("Reject")).toEqual({ decision: "rejected" });
    for (const unclear of ["Ok, let me check with finance", "yes but only the cheaper one", "No idea what this is", "Approve? What is this for", "Reject? Why was I sent this", "I approve this", "Approved by whom", ""]) {
      expect(parseEmailDecision(unclear), unclear).toBeNull();
    }
  });

  describe("replies", () => {
    const sent: { to: string; subject: string; text: string; replyTo?: string }[] = [];
    const received = new Map<string, Record<string, unknown>>();
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/emails") {
        const b = JSON.parse(String(init?.body));
        sent.push({ to: b.to[0], subject: b.subject, text: b.text, replyTo: b.reply_to });
        return Response.json({ id: randomUUID() });
      }
      const m = /^\/emails\/receiving\/([^/]+)(\/attachments)?$/.exec(url.pathname);
      if (m) {
        const e = received.get(m[1]);
        if (!e) return new Response("{}", { status: 404 });
        return m[2] ? Response.json({ object: "list", data: [] }) : Response.json(e);
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    let email: string;

    beforeAll(async () => {
      setResendFetchForTesting(fakeFetch);
      await asSystem((tx) => tx.query("update users set is_demo = false where id = $1", [U.contosoAdmin]));
      email = (await principal(U.contosoAdmin)).email;
    });

    beforeEach(() => {
      sent.length = 0;
      setConfigForTesting({
        appOrigin: "http://localhost:3000",
        demoMode: true,
        email: {
          resendApiKey: "re_test",
          from: "IT Center <support@example.test>",
          inboundDomain: "in.example.test",
          webhookSecret: `whsec_${Buffer.from("test-webhook-secret-0123456789").toString("base64")}`,
        },
      });
    });

    /** Submits a request and returns the reply address on the email to the approver. */
    async function approvalEmail() {
      const r = await ask(await item([{ name: "Owner", approvers: [admins] }]));
      await processJobs({ limit: 50 });
      const mail = sent.find((m) => m.to === email && m.replyTo?.startsWith("t-"));
      expect(mail, "approval email with a reply address").toBeTruthy();
      expect(mail!.text).toContain('Reply "approve" to approve');
      return { id: r.id, to: mail!.replyTo! };
    }

    async function reply(to: string, text: string, from = email) {
      const id = randomUUID();
      received.set(id, { id, from, to: [to], subject: "Re", text, html: null, headers: {}, authentication: { spf: "pass", dkim: "pass", dmarc: "pass" } });
      await recordInboundWebhook(JSON.stringify({ type: "email.received", data: { email_id: id, from, to: [to], subject: "Re" } }));
      const row = (await asSystem((tx) => tx.query<{ id: string }>("select id from inbound_emails where provider_email_id = $1", [id]))).rows[0];
      await ingestInboundEmail(row.id);
      return (await asSystem((tx) => tx.query<{ status: string; reason: string | null }>("select status, reason from inbound_emails where id = $1", [row.id]))).rows[0];
    }

    it('"approve" decides the approval, recorded as by email', async () => {
      const { id, to } = await approvalEmail();
      expect((await reply(to, "Approve\n\nOn Tue, IT Center wrote:\n> Approval needed")).status).toBe("attached");
      const t = await view(id);
      expect(t.approvalStatus).toBe("approved");
      expect(t.approval?.steps[0].slots[0]).toMatchObject({ status: "approved", via: "email" });
    });

    it('"reject" needs a reason; the reason reaches the requester', async () => {
      const { id, to } = await approvalEmail();
      expect((await reply(to, "Reject")).status).toBe("needs_review");
      expect((await view(id)).approvalStatus).toBe("pending");
      expect((await reply(to, "Reject: we already have spares")).status).toBe("attached");
      const t = await view(id, U.contosoRequester);
      expect(t).toMatchObject({ approvalStatus: "rejected", resolutionNote: "Not approved: we already have spares" });
    });

    it("anything unclear, from anyone else, or too late goes to review and decides nothing", async () => {
      const { id, to } = await approvalEmail();
      expect(await reply(to, "Ok, let me check with finance")).toMatchObject({ status: "needs_review" });
      expect((await reply(to, "Approve", "someone-else@example.test")).status).toBe("needs_review");
      expect((await view(id)).approvalStatus).toBe("pending");
      await decide(id, U.contosoAdmin);
      expect((await reply(to, "Reject: changed my mind")).status).toBe("needs_review");
      expect((await view(id)).approvalStatus).toBe("approved");
    });
  });
});
