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

test("folio nav keeps previous chapter until the next is ready (no loading flash)", async ({ page }) => {
  await page.goto("/wybor");
  await page.locator('[data-pick="bg-1879"]').click();
  await page.goto("/czytaj/01-gen/1");
  await expect(page.locator("#chap-heading")).toContainText(/I|1/);
  const firstVerse = await page.locator("#verses li").first().textContent();

  await page.evaluate(() => {
    window.__sawReaderLoading = false;
    const el = document.getElementById("verses");
    const re = /Ładowanie|Tarry a little/i;
    const check = () => {
      if (re.test(el.textContent || "")) window.__sawReaderLoading = true;
    };
    const obs = new MutationObserver(check);
    obs.observe(el, { childList: true, subtree: true, characterData: true });
    window.__readerLoadingObs = obs;
  });

  await page.locator('#folio-nav a[href="/czytaj/01-gen/2"]').click();
  await expect(page).toHaveURL(/\/czytaj\/01-gen\/2$/);
  await expect(page.locator("#chap-heading")).toContainText(/II|2/);
  await expect(page.locator("#verses li").first()).toBeVisible();

  const sawLoading = await page.evaluate(() => {
    window.__readerLoadingObs?.disconnect();
    return window.__sawReaderLoading;
  });
  expect(sawLoading).toBe(false);
  // treść się zmieniła na rozdział 2 (nie utknęliśmy na poprzednim)
  const nextVerse = await page.locator("#verses li").first().textContent();
  expect(nextVerse).not.toBe(firstVerse);
});
