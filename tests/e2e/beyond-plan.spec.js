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
