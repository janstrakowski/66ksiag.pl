import { expect, test } from "@playwright/test";

async function pickBg(page) {
  await page.goto("/wybor");
  await page.locator('[data-pick="bg-1879"]').click();
  await expect(page.locator("#home")).toBeVisible();
}

async function enablePlan(page, chapters = 1) {
  await page.goto("/plan");
  await page.locator("#plan-enabled").check();
  await page.locator('input[name="goal"][value="bible"]').check();
  await page.locator("#plan-chapters").fill(String(chapters));
  await page.locator('#plan-form button[type="submit"]').click();
  await expect(page.locator("#toast")).toBeVisible();
}

test("finishing the portion asks whether to read on", async ({ page }) => {
  await pickBg(page);
  await enablePlan(page, 1);
  await page.goto("/porcja");
  await expect(page.locator("#mark-read-btn")).toBeVisible();
  await page.locator("#mark-read-btn").click();
  await expect(page.locator("#confirm-overlay")).toBeVisible();
  await expect(page.locator("#confirm-ok")).toContainText(/Czytaj dalej|Read yet further/i);
  await expect(page.locator("#plan-banner")).toBeHidden();
  await page.locator("#confirm-cancel").click();
  await expect(page.locator("#home")).toBeVisible();
});

test("reset progress brings the portion back to the start", async ({ page }) => {
  await pickBg(page);
  await enablePlan(page, 3);
  await page.goto("/porcja");
  await page.locator("#mark-read-btn").click();
  await expect(page.locator("#plan-banner")).toContainText(/1 z 3|1 of 3/);

  await page.goto("/plan");
  await page.locator("#plan-reset-progress").click();
  await expect(page.locator("#confirm-overlay")).toBeVisible();
  await page.locator("#confirm-ok").click();
  await expect(page.locator("#toast")).toBeVisible();

  await page.goto("/porcja");
  await expect(page).toHaveURL(/\/porcja\/01-gen\/1$/);
  await expect(page.locator("#plan-banner")).toContainText(/0 z 3|0 of 3/);
  await page.goto("/czytaj/01-gen/1");
  await expect(page.locator("#chapter-done")).toBeHidden();
  await expect(page.locator("#plan-banner")).toBeHidden();
});

test("ordinary reading remembers the last chapter and ignores the plan", async ({ page }) => {
  await pickBg(page);
  await enablePlan(page, 3);
  await page.goto("/czytaj/01-gen/1");
  await expect(page.locator("#chapter-done")).toBeHidden();
  await expect(page.locator("#folio-nav")).toBeVisible();
  await page.goto("/czytaj/01-gen/4");
  await page.goto("/");
  const read = page.locator("#home-read-cta");
  await expect(read.locator(".cta-main")).toContainText(/Kontynuuj|Go on/i);
  await expect(read).toHaveAttribute("href", "/czytaj/01-gen/4");
  const portion = page.locator("#home-plan-cta");
  await expect(portion).toBeVisible();
  await expect(portion).toHaveAttribute("href", /\/porcja\/01-gen\/1$/);
  await expect(page.locator("#home-sync")).toHaveAttribute("href", "/synchronizacja");
});
