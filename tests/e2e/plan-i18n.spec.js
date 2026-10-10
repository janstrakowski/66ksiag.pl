import { expect, test } from "@playwright/test";

test("plan form switches language with edition", async ({ page }) => {
  await page.goto("/wybor");
  await page.locator('[data-pick="bg-1879"]').click();
  await page.goto("/plan");
  await expect(page.locator("#plan [data-i18n='setPlan']")).toHaveText("Ustaw");
  await expect(page.locator("#plan-abandon")).toBeHidden();

  await page.goto("/wybor");
  await page.locator('[data-pick="kjv-1769"]').click();
  await page.goto("/plan");
  await expect(page.locator("#plan [data-i18n='setPlan']")).toHaveText("Appoint");
  await expect(page.locator("#plan [data-i18n='abandonPlan']")).toHaveText("Put off");
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

test("reader is revealed only with a complete folio (no empty moulding)", async ({ page }) => {
  await page.goto("/wybor");
  await page.locator('[data-pick="bg-1879"]').click();
  await expect(page.locator("#home")).toBeVisible();

  await page.evaluate(() => {
    window.__sawEmptyReader = false;
    const reader = document.getElementById("reader");
    const obs = new MutationObserver(() => {
      if (!reader.classList.contains("is-on")) return;
      const verses = document.getElementById("verses");
      const heading = document.getElementById("chap-heading");
      if (!heading?.textContent?.trim() || !verses?.querySelector("li")) {
        window.__sawEmptyReader = true;
      }
    });
    obs.observe(reader, { attributes: true, attributeFilter: ["class"] });
    window.__emptyReaderObs = obs;
  });

  await page.locator("#home-read-cta").click();
  await expect(page.locator("#reader.is-on")).toBeVisible();
  await expect(page.locator("#verses li").first()).toBeVisible();

  const empty = await page.evaluate(() => {
    window.__emptyReaderObs?.disconnect();
    return window.__sawEmptyReader;
  });
  expect(empty).toBe(false);
});

test("folio nav keeps previous chapter until the next is ready (no loading flash)", async ({ page }) => {
  await page.goto("/wybor");
  await page.locator('[data-pick="bg-1879"]').click();
  await page.goto("/czytaj/01-gen/1");
  await expect(page.locator("#chap-heading")).toContainText(/I|1/);
  const firstVerse = await page.locator("#verses li").first().textContent();

  await page.evaluate(() => {
    window.__sawReaderLoading = false;
    window.__partialFolioPaint = false;
    const verses = document.getElementById("verses");
    const heading = document.getElementById("chap-heading");
    const re = /Ładowanie|Tarry a little/i;
    let headingAt = "";
    const obs = new MutationObserver(() => {
      if (re.test(verses.textContent || "")) window.__sawReaderLoading = true;
      const h = heading.textContent || "";
      const v = verses.textContent || "";
      // nagłówek już z rozdz. II, a wersety jeszcze ze starego painta
      if (/II|2/.test(h) && v === window.__verseSnapshot) {
        window.__partialFolioPaint = true;
      }
      if (h !== headingAt) {
        headingAt = h;
        window.__verseSnapshot = v;
      }
    });
    window.__verseSnapshot = verses.textContent || "";
    obs.observe(document.querySelector("#reader .moulding-inner.reader"), {
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.__readerLoadingObs = obs;
  });

  await page.locator('#folio-nav a[href="/czytaj/01-gen/2"]').click();
  await expect(page).toHaveURL(/\/czytaj\/01-gen\/2$/);
  await expect(page.locator("#chap-heading")).toContainText(/II|2/);
  await expect(page.locator("#verses li").first()).toBeVisible();

  const flags = await page.evaluate(() => {
    window.__readerLoadingObs?.disconnect();
    return {
      sawLoading: window.__sawReaderLoading,
      partial: window.__partialFolioPaint,
    };
  });
  expect(flags.sawLoading).toBe(false);
  expect(flags.partial).toBe(false);
  const nextVerse = await page.locator("#verses li").first().textContent();
  expect(nextVerse).not.toBe(firstVerse);
});
