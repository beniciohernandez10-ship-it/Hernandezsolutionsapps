import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { withUser } from "@/lib/db";
import { articleFeedback, getArticle, listArticles, saveArticle, suggestArticles } from "@/lib/kb/service";
import { markdownToText, parseInline, parseMarkdown } from "@/lib/kb/markdown";

const U = DEMO.users;
const C = DEMO.customers.contoso;
const F = DEMO.customers.fabrikam;

const article = (o: object = {}) => ({
  title: "Connect to the office printer",
  summary: "Add the front-desk printer.",
  body: "## Steps\n\n1. Open Settings\n2. Add printer",
  category: "hardware",
  audience: "everyone",
  customerId: null,
  status: "published",
  ...o,
});

beforeAll(async () => {
  await freshDatabase();
});

describe("knowledge base visibility", () => {
  it("starter articles are published for every client", async () => {
    const list = await listArticles(await principal(U.fabrikamRequester));
    expect(list.map((a) => a.title)).toContain("My computer is running slow");
    expect(await listArticles(await principal(U.operator))).toEqual([]);
  });

  it("customer, technician-only and draft articles reach only the right people", async () => {
    const tech = await principal(U.tech);
    const contosoOnly = (await saveArticle(tech, null, article({ title: "Contoso Wi-Fi guest network", audience: "customer", customerId: C }))).id;
    const staffOnly = (await saveArticle(tech, null, article({ title: "Contoso firewall admin notes", audience: "staff", customerId: C }))).id;
    const draft = (await saveArticle(tech, null, article({ title: "Work in progress draft", status: "draft" }))).id;
    const titles = async (u: string) => (await listArticles(await principal(u), { drafts: true })).map((a) => a.id);
    expect(await titles(U.contosoRequester)).toEqual(expect.arrayContaining([contosoOnly]));
    expect(await titles(U.contosoRequester)).not.toContain(staffOnly);
    expect(await titles(U.contosoRequester)).not.toContain(draft);
    expect(await titles(U.fabrikamRequester)).not.toContain(contosoOnly);
    expect(await titles(U.techFabrikam)).not.toContain(staffOnly);
    expect(await titles(U.tech)).toEqual(expect.arrayContaining([contosoOnly, staffOnly, draft]));
    await expectAppError(getArticle(await principal(U.fabrikamAdmin), contosoOnly), 404);
    await expectAppError(getArticle(await principal(U.contosoAdmin), staffOnly), 404);
    // Direct reads respect the same rules.
    const direct = await withUser(U.contosoRequester, (tx) => tx.query("select id from kb_articles where id = any($1::uuid[])", [[staffOnly, draft]]));
    expect(direct.rows).toHaveLength(0);
  });

  it("only technicians write, and only for customers they serve", async () => {
    await expectAppError(saveArticle(await principal(U.contosoAdmin), null, article()), 403);
    await expectAppError(saveArticle(await principal(U.techFabrikam), null, article({ audience: "customer", customerId: C })), 403);
    await expectAppError(saveArticle(await principal(U.tech), null, article({ audience: "customer", customerId: null })), 422);
    const direct = withUser(U.contosoRequester, (tx) =>
      tx.query("insert into kb_articles (title, body, category, audience, status, author_user_id) values ('Sneaky', 'x', 'general', 'everyone', 'published', $1)", [
        U.contosoRequester,
      ]),
    );
    await expect(direct).rejects.toThrow();
    const id = (await saveArticle(await principal(U.techFabrikam), null, article({ title: "Fabrikam scanner", audience: "customer", customerId: F }))).id;
    await expectAppError(saveArticle(await principal(U.tech), id, article({ title: "Changed", audience: "customer", customerId: F })), 403);
  });
});

describe("search, suggestions and feedback", () => {
  it("finds articles by words in any order, and never suggests technician-only ones to anyone", async () => {
    const tech = await principal(U.tech);
    await saveArticle(tech, null, article({ title: "Reset the VPN client", body: "Restart the VPN service.", audience: "staff", customerId: null }));
    const found = await listArticles(await principal(U.contosoRequester), { q: "outlook password keeps asking" });
    expect(found.length).toBeGreaterThan(0);
    const s = await suggestArticles(await principal(U.contosoRequester), "my computer is so slow today");
    expect(s[0].title).toBe("My computer is running slow");
    expect((await suggestArticles(tech, "vpn client")).some((a) => a.title === "Reset the VPN client")).toBe(false);
    expect(await suggestArticles(tech, "a")).toEqual([]);
  });

  it("records one vote per person and counts views", async () => {
    const req = await principal(U.contosoRequester);
    const a = (await listArticles(req, { q: "slow" }))[0];
    await articleFeedback(req, a.id, true);
    await articleFeedback(req, a.id, true);
    await articleFeedback(req, a.id, false);
    await getArticle(req, a.id, { recordView: true });
    const after = await getArticle(req, a.id);
    expect(after.helpful).toBe(0);
    expect(after.notHelpful).toBe(1);
    expect(after.myFeedback).toBe(false);
    expect(after.views).toBe(1);
    // Can't vote on what you can't see.
    const hidden = (await saveArticle(await principal(U.tech), null, article({ title: "Hidden staff note", audience: "staff" }))).id;
    await expectAppError(articleFeedback(req, hidden, true), 404);
  });
});

describe("markdown", () => {
  it("parses the supported subset and drops unsafe links", () => {
    const b = parseMarkdown("## Title\n\nSome **bold** and `code`.\n\n- [ ] check\n- [ ] two\n\n1. one\n2. two\n\n> **Note**\n> careful\n\n[ok](https://example.com) [bad](javascript:alert(1))");
    expect(b.map((x) => x.t)).toEqual(["h2", "p", "check", "ol", "quote", "p"]);
    const links = parseInline("[ok](https://example.com) [bad](javascript:alert(1)) [rel](/portal/kb)");
    expect(links.filter((x) => x.t === "link").map((x) => (x as { href: string }).href)).toEqual(["https://example.com", "/portal/kb"]);
    expect(markdownToText("## Hi\n\n**Bold** [link](https://x.y)")).toBe("Hi Bold link");
  });
});
