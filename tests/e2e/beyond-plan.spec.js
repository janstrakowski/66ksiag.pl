import { expect, test } from "@playwright/test";

async function pickBg(page) {
  await page.goto("/wybor");
  await page.locator('[data-pick="bg-1879"]').click();
  await expect(page.locator("#home")).toBeVisible();
}

async function enablePlan(page, chapters = 1) {
  await page.goto("/plan");
  await page.locator("#plan-enabled").check();
  await page.locator("#plan-chapters").fill(String(chapters));
  await page.locator('#plan-form button[type="submit"]').click();
  await expect(page.locator("#toast")).toBeVisible();
}

async function readToday(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("ksiag-plan-v1");
    return raw ? JSON.parse(raw).readToday : [];
  });
}

test("mark button only on the next chapter after last credited", async ({ page }) => {
  await pickBg(page);
  await enablePlan(page, 1);

  await page.goto("/czytaj/01-gen/2");
  await expect(page.locator("#chapter-done")).toBeHidden();

  await page.goto("/czytaj/01-gen/1");
  await expect(page.locator("#chapter-done")).toBeVisible();
  await page.locator("#mark-read-btn").click();
  await expect(page.locator("#plan-banner")).toBeHidden();

  await page.goto("/czytaj/01-gen/5");
  await expect(page.locator("#chapter-done")).toBeHidden();

  await page.goto("/czytaj/01-gen/2");
  await expect(page.locator("#chapter-done")).toBeVisible();
  await expect(page.locator("#mark-read-btn")).toContainText(/ponad plan|beyond/i);
  await page.locator("#mark-read-btn").click();
  await expect(page.locator("#mark-read-btn")).toContainText(/ponad plan|beyond|Zaliczone|Reckoned/i);
});

test("after reset mark button only on goal start, not chapter 2", async ({ page }) => {
  await pickBg(page);
  await enablePlan(page, 1);

  await page.goto("/czytaj/01-gen/1");
  await page.locator("#mark-read-btn").click();

  await page.goto("/plan");
  await page.locator("#plan-reset-progress").click();
  await page.locator("#confirm-ok").click();
  await expect(page.locator("#toast")).toBeVisible();

  await page.goto("/czytaj/01-gen/2");
  await expect(page.locator("#chapter-done")).toBeHidden();

  await page.goto("/czytaj/01-gen/1");
  await expect(page.locator("#chapter-done")).toBeVisible();
  await expect(page.locator("#mark-read-btn")).toContainText(/Oznacz|Mark|Reckon the chapter/i);
});

test("folio next only navigates and does not mark the chapter", async ({ page }) => {
  await pickBg(page);
  await enablePlan(page, 2);

  await page.goto("/czytaj/01-gen/1");
  await expect(page.locator("#chapter-done")).toBeVisible();
  await page.locator("#folio-nav a[href='/czytaj/01-gen/2']").click();
  await expect(page).toHaveURL(/\/czytaj\/01-gen\/2$/);

  expect(await readToday(page)).toEqual([]);
  await expect(page.locator("#chapter-done")).toBeHidden();

  await page.goto("/czytaj/01-gen/1");
  await expect(page.locator("#chapter-done")).toBeVisible();
  expect(await readToday(page)).toEqual([]);
});

test("home Continue goes to next after last marked, not last browsed", async ({ page }) => {
  await pickBg(page);
  await enablePlan(page, 3);

  await page.goto("/czytaj/01-gen/1");
  await page.locator("#mark-read-btn").click();
  expect(await readToday(page)).toEqual(["01-gen/1"]);

  // przeglądanie dalej bez oznaczania
  await page.goto("/czytaj/01-gen/5");
  await expect(page.locator("#chapter-done")).toBeHidden();
  expect(await readToday(page)).toEqual(["01-gen/1"]);

  await page.goto("/");
  const cta = page.locator("#home-read-cta");
  await expect(cta.locator(".cta-main")).toContainText(/Kontynuuj|Go on/i);
  await expect(cta).toHaveAttribute("href", "/czytaj/01-gen/2");

  await cta.click();
  await expect(page).toHaveURL(/\/czytaj\/01-gen\/2$/);
  await expect(page.locator("#chapter-done")).toBeVisible();
  await expect(page.locator("#mark-read-btn")).toContainText(/Oznacz|Mark|Reckon the chapter/i);
});
