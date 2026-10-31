import { expect, test } from "@playwright/test";

test.describe("edition picker", () => {
  test("shows two tiles and ornaments", async ({ page }) => {
    await page.goto("/wybor");
    await expect(page.locator("#pick")).toBeVisible();
    await expect(page.locator("#pick-choices [data-pick]")).toHaveCount(2);
    await expect(page.locator("#pick .fleurons img")).toBeVisible();
    await expect(page.locator("#pick .rules")).toBeVisible();
    await expect(page.locator("#pick-title")).toHaveCount(0);
  });

  test("choosing BG opens Polish title card", async ({ page }) => {
    await page.goto("/wybor");
    await page.locator('[data-pick="bg-1879"]').click();
    await expect(page.locator("#home")).toBeVisible();
    await expect(page.locator("#home-title")).toContainText(/Biblia/i);
    await expect(page.locator("#home-audio-download")).toHaveCount(0);
  });

  test("choosing KJV opens English title card without a download", async ({ page }) => {
    await page.goto("/wybor");
    await page.locator('[data-pick="kjv-1769"]').click();
    await expect(page.locator("#home")).toBeVisible();
    await expect(page.locator("#home-title")).toContainText(/Holy Bible/i);
    await expect(page.locator("#home-audio-download")).toHaveCount(0);
    await expect(page.getByText(/Pobierz audio|Download audio/)).toHaveCount(0);
  });
});

test.describe("reader", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/wybor");
    await page.locator('[data-pick="kjv-1769"]').click();
    await expect(page.locator("#home")).toBeVisible();
  });

  test("opens Genesis 1 with verses and listen control", async ({ page }) => {
    await page.goto("/czytaj/01-gen/1");
    await expect(page.locator("#reader")).toBeVisible();
    await expect(page.locator("#chap-heading")).toContainText(/Chapter|I/i);
    await expect(page.locator("#verses li")).toHaveCount(31);
    await expect(page.locator("#verses li").first()).toContainText(/beginning/i);
    await expect(page.locator("#audio-controls")).toBeVisible();
    await expect(page.locator("#audio-play-btn")).toBeVisible();
  });

  test("BG Gdańsk reader has no Listen button", async ({ page }) => {
    await page.goto("/wybor");
    await page.locator('[data-pick="bg-1879"]').click();
    await page.goto("/czytaj/01-gen/1");
    await expect(page.locator("#reader")).toBeVisible();
    await expect(page.locator("#verses li").first()).toBeVisible();
    await expect(page.locator("#audio-controls")).toBeHidden();
    await expect(page.locator("#audio-play-btn")).toBeHidden();
    await expect(page.locator("body")).toContainText(/Rodzaju|Rozdział|początku|poczatku/i);
    await expect(page.locator("#audio-play-btn")).not.toBeVisible();
  });

  test("selecting a verse updates URL", async ({ page }) => {
    await page.goto("/czytaj/01-gen/1");
    await page.locator('#verses li[data-v="16"]').click();
    await expect(page).toHaveURL(/\/czytaj\/01-gen\/1\/16$/);
    await expect(page.locator('#verses li[data-v="16"]')).toHaveClass(/is-sel/);
  });

  test("books index lists OT and NT", async ({ page }) => {
    await page.goto("/ksiegi");
    await expect(page.locator("#books")).toBeVisible();
    await expect(page.locator("#book-list-root")).toContainText(/Genesis|Matthew|Revelation/i);
  });
});

test.describe("daily plan", () => {
  test("saves plan and shows banner while incomplete", async ({ page }) => {
    await page.goto("/wybor");
    await page.locator('[data-pick="bg-1879"]').click();
    await page.goto("/plan");
    await expect(page.locator("#plan")).toBeVisible();
    await page.locator('input[name="goal"][value="nt"]').check();
    await page.locator('input[name="mode"][value="chapters"]').check();
    await page.locator("#plan-chapters").fill("2");
    await page.locator("#plan-set").click();
    await page.locator("#confirm-cancel").click();
    await expect(page.locator("#toast")).toBeVisible({ timeout: 5000 });
    await page.goto("/czytaj/40-mat/1");
    await expect(page.locator("#reader")).toBeVisible();
    await expect(page.locator("#chapter-done")).toBeHidden();
    await page.goto("/porcja");
    await expect(page).toHaveURL(/\/porcja\/40-mat\/1$/);
    await expect(page.locator("#mark-read-btn")).toBeVisible();
    await expect(page.locator("#plan-banner")).toContainText(/0 z 2|0 of 2/);
    await page.locator("#mark-read-btn").click();
    await expect(page.locator("#plan-banner")).toContainText(/1 z 2|1 of 2/);
  });
});

test.describe("API / static contracts", () => {
  test("audio-catalog.json is served", async ({ request }) => {
    const res = await request.get("/audio-catalog.json");
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.count).toBe(1189);
    expect(json.chapters[0].book).toBe("01-gen");
  });

  test("chapter JSON for BG and KJV", async ({ request }) => {
    const bg = await request.get("/bg/1879/01-gen/1.json");
    const kjv = await request.get("/kjv/1769/01-gen/1.json");
    expect(bg.ok()).toBeTruthy();
    expect(kjv.ok()).toBeTruthy();
    const bj = await bg.json();
    const kj = await kjv.json();
    expect(bj.verses.length).toBe(kj.verses.length);
  });

  test("missing data path is 404 not SPA HTML", async ({ request }) => {
    const res = await request.get("/kjv/1769/01-gen/999.json");
    expect(res.status()).toBe(404);
  });

  test("self-hosted Scourby mp3 for Genesis 1", async ({ request }) => {
    const res = await request.get("/kjv/1769/01-gen/1.mp3");
    expect(res.ok()).toBeTruthy();
    const ct = res.headers()["content-type"] || "";
    expect(ct).toMatch(/audio|mpeg/i);
    const buf = await res.body();
    expect(buf.byteLength).toBeGreaterThan(10_000);
  });
});

test.describe("navigation resilience", () => {
  test("unknown deep link without edition goes to picker", async ({ page }) => {
    await page.goto("/czytaj/01-gen/1");
    // no edition chosen → pick
    await expect(page.locator("#pick")).toBeVisible();
  });

  test("change edition returns to picker", async ({ page }) => {
    await page.goto("/wybor");
    await page.locator('[data-pick="bg-1879"]').click();
    await page.locator("#home-change-edition").click();
    await expect(page.locator("#pick")).toBeVisible();
  });

  test("SPA client navigation books → home", async ({ page }) => {
    await page.goto("/wybor");
    await page.locator('[data-pick="kjv-1769"]').click();
    await page.locator("#home-books").click();
    await expect(page.locator("#books")).toBeVisible();
    await page.locator('#books .topbar a[href="/"]').click();
    await expect(page.locator("#home")).toBeVisible();
  });
});
