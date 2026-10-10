import { expect, test } from "@playwright/test";

async function pickBg(page) {
  await page.goto("/wybor");
  await page.locator('[data-pick="bg-1879"]').click();
  await expect(page.locator("#home")).toBeVisible();
}

async function enablePlan(page, chapters = 1) {
  await page.goto("/plan");
  await page.locator("#plan-chapters").fill(String(chapters));
  await page.locator("#plan-set").click();
  await page.locator("#confirm-cancel").click();
  await expect(page.locator("#toast")).toBeVisible();
}

async function readToday(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("ksiag-plan-v1");
    return raw ? JSON.parse(raw).readToday : [];
  });
}

test("the ordinary reader never shows the portion button", async ({ page }) => {
  await pickBg(page);
  await enablePlan(page, 1);

  await page.goto("/czytaj/01-gen/2");
  await expect(page.locator("#chapter-done")).toBeHidden();
  await page.goto("/czytaj/01-gen/1");
  await expect(page.locator("#chapter-done")).toBeHidden();
  await expect(page.locator("#folio-nav")).toBeVisible();

  await page.goto("/porcja");
  await expect(page).toHaveURL(/\/porcja\/01-gen\/1$/);
  await expect(page.locator("#chapter-done")).toBeVisible();
  await expect(page.locator("#folio-nav")).toBeHidden();
  await expect(page.locator("#reader-back")).toHaveAttribute("href", "/");
});

test("reading past the portion stays in the portion reader", async ({ page }) => {
  await pickBg(page);
  await enablePlan(page, 1);

  await page.goto("/porcja");
  await page.locator("#mark-read-btn").click();
  await expect(page.locator("#confirm-overlay")).toBeVisible();
  await page.locator("#confirm-ok").click();
  await expect(page).toHaveURL(/\/porcja\/01-gen\/2$/);
  await expect(page.locator("#mark-read-btn")).toContainText(/Rozdział przeczytany|This chapter is read/i);
  await expect(page.locator("#plan-banner")).toContainText(/Ponad plan|Beyond the portion/i);
  await expect(page.locator("#plan-banner")).not.toContainText(/0 min/);
});

test("folio next only navigates and does not mark the chapter", async ({ page }) => {
  await pickBg(page);
  await enablePlan(page, 2);

  await page.goto("/czytaj/01-gen/1");
  await expect(page.locator("#chapter-done")).toBeHidden();
  await page.locator("#folio-nav a[href='/czytaj/01-gen/2']").click();
  await expect(page).toHaveURL(/\/czytaj\/01-gen\/2$/);
  expect(await readToday(page)).toEqual([]);
  await expect(page.locator("#chapter-done")).toBeHidden();
});

test("home continue follows the last opened chapter, the portion follows the plan", async ({ page }) => {
  await pickBg(page);
  await enablePlan(page, 3);

  await page.goto("/porcja");
  await page.locator("#mark-read-btn").click();
  expect(await readToday(page)).toEqual(["01-gen/1"]);

  await page.goto("/czytaj/01-gen/5");
  await expect(page.locator("#chapter-done")).toBeHidden();

  await page.goto("/");
  const read = page.locator("#home-read-cta");
  await expect(read.locator(".cta-main")).toContainText(/Kontynuuj|Go on/i);
  await expect(read).toHaveAttribute("href", "/czytaj/01-gen/5");

  const portion = page.locator("#home-plan-cta");
  await expect(portion).toHaveAttribute("href", /\/porcja\/01-gen\/2$/);
  await portion.click();
  await expect(page).toHaveURL(/\/porcja\/01-gen\/2$/);
  await expect(page.locator("#chapter-done")).toBeVisible();
  await expect(page.locator("#folio-nav")).toBeHidden();
});

test("a New Testament goal opens that portion, not Genesis", async ({ page }) => {
  await pickBg(page);
  await page.goto("/plan");
  await page.locator('input[name="goal"][value="nt"]').check();
  await page.locator("#plan-chapters").fill("2");
  await page.locator("#plan-set").click();
  await page.locator("#confirm-cancel").click();
  await expect(page.locator("#toast")).toBeVisible();

  await page.goto("/czytaj/01-gen/1");
  await expect(page.locator("#chapter-done")).toBeHidden();

  await page.goto("/porcja");
  await expect(page).toHaveURL(/\/porcja\/40-mat\/1$/);
  await page.locator("#mark-read-btn").click();
  await expect(page).toHaveURL(/\/porcja\/40-mat\/2$/);
});
