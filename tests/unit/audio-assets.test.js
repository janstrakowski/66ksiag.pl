import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyWranglerPatch } from "../../scripts/patch-wrangler-assets.mjs";
import { assetKey, assetOverride, mapEcftfUrls } from "../../scripts/wrangler-asset-hook.mjs";

const manifest = JSON.parse(readFileSync("data/kjv/1769/audio-assets-manifest.json", "utf8"));

describe("KJV static asset manifest", () => {
  it("records the wrangler Blake3 hash for every chapter", () => {
    expect(manifest.count).toBe(1189);
    expect(manifest.algorithm).toBe("blake3(base64+ext)[0..32]");
    expect(Object.keys(manifest.files)).toHaveLength(1189);
    expect(manifest.files["/kjv/1769/01-gen/1.mp3"]).toEqual({
      oid: "d1a95181330513ee89bf62a6fe9cbd7d345530012d870ea19205e3785ea12a94",
      size: 2149841,
      assetHash: "68327846057143e1d97a42a8ca0fd125",
    });
  });

  it("uses the committed hash only for an LFS pointer", () => {
    const files = manifest.files;
    expect(assetKey("/tmp/dist/kjv/1769/01-gen/1.mp3")).toBe("/kjv/1769/01-gen/1.mp3");
    expect(assetKey("/tmp/dist/kjv/1769/01-gen/1.words.json")).toBeNull();
    expect(assetOverride("/tmp/dist/kjv/1769/01-gen/1.mp3", 132, files)).toEqual({
      hash: "68327846057143e1d97a42a8ca0fd125",
      size: 2149841,
    });
    expect(assetOverride("/tmp/dist/kjv/1769/01-gen/1.mp3", 2149841, files)).toBeNull();
  });

  it("maps ECFTF chapter links in books.json order", () => {
    const html = `
      <a href="Genesis/Genesis_01.mp3">1</a>
      <a href="Genesis/Genesis_01.mp3">dup</a>
      <a href="/Genesis/Genesis_02.mp3">2</a>
      <a href="Exodus/Exodus_01.mp3">3</a>
    `;
    const urls = mapEcftfUrls(html, [
      { id: "01-gen", chapters: 2 },
      { id: "02-exo", chapters: 1 },
    ]);
    expect(urls).toEqual({
      "/kjv/1769/01-gen/1.mp3": "https://earnestlycontendingforthefaith.com/Genesis/Genesis_01.mp3",
      "/kjv/1769/01-gen/2.mp3": "https://earnestlycontendingforthefaith.com/Genesis/Genesis_02.mp3",
      "/kjv/1769/02-exo/1.mp3": "https://earnestlycontendingforthefaith.com/Exodus/Exodus_01.mp3",
    });
  });

  it("patches wrangler 4.149 once", () => {
    const cli = readFileSync("node_modules/wrangler/wrangler-dist/cli.js", "utf8");
    const patched = applyWranglerPatch(cli);
    expect(patched).toContain("globalThis.__ksiagAssetOverride");
    expect(patched).toContain("globalThis.__ksiagPrepareBucket");
    expect(patched).toContain("globalThis.__ksiagReleaseAssets");
    expect(applyWranglerPatch(patched)).toBe(patched);
  });
});
