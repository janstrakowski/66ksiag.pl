import { describe, expect, it } from "vitest";
import { retiredAsset } from "../../worker/src/index.ts";

describe("retired web-app assets", () => {
  it("serves an unregister script at /sw.js and leaves edition paths alone", async () => {
    const sw = retiredAsset(new Request("https://66ksiag.pl/sw.js"));
    expect(sw.status).toBe(200);
    expect(sw.headers.get("content-type")).toContain("javascript");
    const body = await sw.text();
    expect(body).toContain("self.registration.unregister()");
    expect(body).toContain("ksiag-v\\d+");
    expect(body).not.toContain("ksiag-scourby");
    expect(body).not.toContain("addAll");

    const edition = retiredAsset(new Request("https://66ksiag.pl/bg/1879/manifest.json"));
    expect(edition).toBeNull();
  });

  it("does not serve a web app manifest", () => {
    const manifest = retiredAsset(new Request("https://66ksiag.pl/manifest.webmanifest"));
    expect(manifest.status).toBe(404);
    expect(retiredAsset(new Request("https://66ksiag.pl/manifest.webmanifest/"))?.status).toBe(404);
  });
});
