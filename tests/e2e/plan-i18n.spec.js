import { expect, test } from "@playwright/test";

test("plan form switches language with edition", async ({ page }) => {
  await page.goto("/wybor");
  await page.locator('[data-pick="bg-1879"]').click();
  await page.goto("/plan");
  await expect(page.locator("#plan [data-i18n='enablePlan']")).toContainText(/Włącz/i);

  await page.goto("/wybor");
  await page.locator('[data-pick="kjv-1769"]').click();
  await page.goto("/plan");
  await expect(page.locator("#plan [data-i18n='enablePlan']")).toContainText(/Appoint|portion/i);
  await expect(page.locator("#plan [data-i18n='savePlan']")).toBeVisible();
});

test("KJV reader uses Early Modern chrome strings", async ({ page }) => {
  await page.goto("/wybor");
  await page.locator('[data-pick="kjv-1769"]').click();
  await page.goto("/czytaj/01-gen/1");
  await expect(page.locator("#share-btn")).toContainText(/publish|abroad/i);
  await expect(page.locator('#reader a[href="/plan"]')).toContainText(/portion/i);
});

test("folio nav moves between chapters", async ({ page }) => {
  await page.goto("/wybor");
  await page.locator('[data-pick="kjv-1769"]').click();
  await page.goto("/czytaj/01-gen/1");
  await page.locator('#folio-nav a[href="/czytaj/01-gen/2"]').click();
  await expect(page).toHaveURL(/\/czytaj\/01-gen\/2$/);
  await expect(page.locator("#verses li").first()).toBeVisible();
});
