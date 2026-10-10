import { expect, test, type Page } from "@playwright/test";

const WEBSITE = "https://thehernandezsolutions.com";

async function signInAs(page: Page, persona: RegExp) {
  await page.goto("/signin");
  await page.getByRole("button", { name: persona }).click();
  await page.waitForURL(/\/portal$/);
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("unauthenticated visitors are sent to sign-in, which links back to the website", async ({ page }) => {
  await page.goto("/portal/tickets");
  await expect(page).toHaveURL(/\/signin\?returnTo=%2Fportal%2Ftickets/);
  await expect(page.getByRole("link", { name: /Back to thehernandezsolutions.com/ })).toHaveAttribute("href", WEBSITE);
});

test("requester submits a request, replies, and sees it in the list", async ({ page }, info) => {
  const errors = collectErrors(page);
  await signInAs(page, /Riley Rivera/);
  await page.goto("/portal/tickets/new");
  const title = `Docking station issue ${info.project.name} (Demo)`;
  // Empty submit shows accessible inline errors and keeps the user on the form.
  await page.getByLabel("Title").fill("");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText(/at least 3 characters/)).toBeVisible();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel(/What.s happening/).fill(`Second screen flickers.\n<img src=x onerror="window.__xss=1">`);
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(/Request #\d+ submitted/)).toBeVisible();
  // Markup in ticket text is shown as text, never executed.
  await expect(page.getByText('<img src=x onerror="window.__xss=1">')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  await page.getByRole("textbox", { name: "Reply" }).fill("It also happens with the laptop lid closed.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("It also happens with the laptop lid closed.")).toBeVisible();

  await page.goto("/portal/tickets");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  expect(errors).toEqual([]);
});

test("requester cannot open another customer's ticket by URL", async ({ page }) => {
  await signInAs(page, /Tess Torres/);
  await page.goto("/portal/tickets?q=Front+desk");
  await page.locator(".ticket-row").first().click();
  await page.waitForURL(/tickets\/[0-9a-f-]{36}$/);
  const contosoUrl = page.url();
  await page.context().clearCookies();
  await signInAs(page, /Fiona Flores/);
  await page.goto(contosoUrl);
  await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
});

test("technician sees private notes; client admin of the same customer does not", async ({ page }) => {
  await signInAs(page, /Tess Torres/);
  await page.goto("/portal/tickets?q=Front+desk");
  await page.locator(".ticket-row").first().click();
  await expect(page.getByText("Private note, technicians only").first()).toBeVisible();
  const url = page.url();
  await page.context().clearCookies();
  await signInAs(page, /Cora Chen/);
  await page.goto(url);
  await expect(page.getByRole("heading", { name: /Front desk PC/ })).toBeVisible();
  await expect(page.getByText("Spooler service crashed")).toHaveCount(0);
  await expect(page.getByText("Private note, technicians only")).toHaveCount(0);
});

test("navigation works at this viewport, including the return link to the website", async ({ page, isMobile }) => {
  await signInAs(page, /Cora Chen/);
  if (isMobile) {
    await page.getByLabel("Open menu").click();
    await expect(page.locator(".mobile-panel").getByRole("link", { name: "Devices" })).toBeVisible();
    await expect(page.locator(".mobile-panel").getByRole("link", { name: /Back to thehernandezsolutions.com/ })).toHaveAttribute("href", WEBSITE);
    await page.locator(".mobile-panel").getByRole("link", { name: "Devices" }).click();
  } else {
    await expect(page.locator(".site-header").getByRole("link", { name: /thehernandezsolutions.com/ })).toHaveAttribute("href", WEBSITE);
    await page.locator(".site-header nav").getByRole("link", { name: "Devices" }).click();
  }
  await expect(page.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();
  await expect(page.getByText("Not compliant").first()).toBeVisible();
  // No horizontal page scroll at this width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("sign-out ends the session and offers the way back to the website", async ({ page, isMobile }) => {
  await signInAs(page, /Riley Rivera/);
  if (isMobile) await page.getByLabel("Open menu").click();
  await page.getByRole("button", { name: "Sign out" }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/signed-out$/);
  await expect(page.getByRole("link", { name: "Return to thehernandezsolutions.com" })).toHaveAttribute("href", WEBSITE);
  await page.goto("/portal");
  await expect(page).toHaveURL(/\/signin/);
  const me = await page.request.get("/api/me");
  expect(me.status()).toBe(401);
});

test("security headers are present", async ({ request }) => {
  const r = await request.get("/signin");
  const h = r.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/);
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
});

test("technician registers a device, gets the next name and a printable QR label", async ({ page }) => {
  const errors = collectErrors(page);
  await signInAs(page, /Tess Torres/);
  await page.goto("/portal/devices");
  await expect(page.getByRole("link", { name: "WRKSTN-001" })).toBeVisible();
  await page.getByRole("link", { name: "Register device" }).click();
  await page.getByLabel("Laptop").check();
  await page.getByLabel("Primary user").fill("Riley");
  await page.getByRole("button", { name: /Riley Rivera/ }).click();
  await page.getByLabel("Location").fill("Exam room 3");
  await page.getByRole("button", { name: "Register and get name" }).click();
  await expect(page).toHaveURL(/\/portal\/devices\/[0-9a-f-]{36}\?created=1$/);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^LAPTOP-\d{3}$/);
  const tag = (await heading.textContent())!.trim();
  await expect(page.getByRole("img", { name: `Label for ${tag}` })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "Exam room 3" })).toBeVisible();
  await page.getByRole("link", { name: "Print label" }).click();
  await expect(page.getByRole("heading", { name: "Print 1 label" })).toBeVisible();
  await expect(page.getByRole("img", { name: `Label for ${tag}` })).toBeVisible();
  expect(errors).toEqual([]);
});

test("QR short links require sign-in and respect customer boundaries", async ({ page, browser }) => {
  await page.goto("/a/demofrontd");
  await expect(page).toHaveURL(/\/signin\?returnTo=%2Fa%2Fdemofrontd/);
  await signInAs(page, /Cora Chen/);
  await page.goto("/a/demofrontd");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("WRKSTN-001");
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  const other = await browser.newPage();
  await signInAs(other, /Fiona Flores/);
  const res = await other.goto("/a/demofrontd");
  expect(res?.status()).toBe(404);
  await other.close();
});
