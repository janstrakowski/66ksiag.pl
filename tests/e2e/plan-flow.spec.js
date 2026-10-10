import { expect, test } from "@playwright/test";

async function pickBg(page) {
  await page.goto("/wybor");
  await page.locator('[data-pick="bg-1879"]').click();
  await expect(page.locator("#home")).toBeVisible();
}

async function enablePlan(page, chapters = 1) {
  await page.goto("/plan");
  await page.locator('input[name="goal"][value="bible"]').check();
  await page.locator("#plan-chapters").fill(String(chapters));
  await page.locator("#plan-set").click();
  await page.locator("#confirm-cancel").click();
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

test("the notification offer and the switch share one setting", async ({ page, context }) => {
  await pickBg(page);
  await context.grantPermissions(["notifications"], { origin: new URL(page.url()).origin });
  await page.goto("/plan");
  await page.locator("#plan-set").click();
  await expect(page.locator("#confirm-title")).toContainText(/powiadomienia/i);
  await page.locator("#confirm-ok").click();
  await expect(page.locator("#plan-active")).toBeVisible();
  await expect(page.locator("#plan-setup")).toBeHidden();
  await expect(page.locator("#plan-notify-on")).toBeChecked();

  await page.locator("#plan-notify-off").check();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("ksiag-plan-v1")).notifications)).toBe(false);
  await expect(page.locator("#plan-notify-off")).toBeChecked();

  await page.locator("#plan-notify-on").check();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("ksiag-plan-v1")).notifications)).toBe(true);

  await page.locator("#plan-abandon").click();
  await expect(page.locator("#confirm-title")).toContainText(/Porzucić/i);
  await page.locator("#confirm-cancel").click();
  await expect(page.locator("#plan-active")).toBeVisible();

  await page.locator("#plan-abandon").click();
  await page.locator("#confirm-ok").click();
  await expect(page.locator("#plan-setup")).toBeVisible();
  await expect(page.locator("#plan-notify-on")).toBeChecked();

  await page.locator("#plan-set").click();
  await expect(page.locator("#confirm-overlay")).toBeHidden();
  await expect(page.locator("#plan-active")).toBeVisible();
  await expect(page.locator("#plan-notify-on")).toBeChecked();
});
