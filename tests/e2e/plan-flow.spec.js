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

test("completing daily quota hides plan banner at 100%", async ({ page }) => {
  await pickBg(page);
  await enablePlan(page, 1);
  await page.goto("/czytaj/01-gen/1");
  await page.locator("#mark-read-btn").click();
  // 100% → banner hidden per app rules
  await expect(page.locator("#plan-banner")).toBeHidden();
});

test("reset progress confirm dialog works", async ({ page }) => {
  await pickBg(page);
  await enablePlan(page, 3);
  await page.goto("/czytaj/01-gen/1");
  await page.locator("#mark-read-btn").click();
  await expect(page.locator("#plan-banner")).toBeVisible();

  await page.goto("/plan");
  await page.locator("#plan-reset-progress").click();
  await expect(page.locator("#confirm-overlay")).toBeVisible();
  await page.locator("#confirm-ok").click();
  await expect(page.locator("#toast")).toBeVisible();
  await page.goto("/czytaj/01-gen/1");
  // po resecie plan wciąż włączony → baner z 0%
  await expect(page.locator("#plan-banner")).toBeVisible();
  await expect(page.locator("#plan-banner")).toContainText(/0\s*%/);
});

test("home CTA continues plan assignment after partial progress", async ({ page }) => {
  await pickBg(page);
  await enablePlan(page, 3);
  await page.goto("/czytaj/01-gen/1");
  await page.locator("#mark-read-btn").click();
  await page.goto("/czytaj/01-gen/4");
  await page.goto("/");
  await expect(page.locator("#home-read-cta")).toBeVisible();
  await expect(page.locator("#home-read-cta .cta-main")).toContainText(/Kontynuuj|Go on/i);
  await expect(page.locator("#home-read-cta")).toHaveAttribute("href", "/czytaj/01-gen/2");
});
