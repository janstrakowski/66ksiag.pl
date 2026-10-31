import { describe, expect, it } from "vitest";
import worker, { retiredAsset } from "../../worker/src/index.ts";

function fakeEnv(books = [{ id: "43-joh", short: "J", aliases: ["j", "jn", "jan"] }]) {
  return {
    ASSETS: {
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/bg/1879/books.json") {
          return new Response(JSON.stringify({ books }), { status: 200 });
        }
        return new Response("asset:" + url.pathname, { status: 200 });
      },
    },
  };
}

describe("retired web-app assets", () => {
  it("serves an unregister script at /sw.js and leaves edition paths alone", async () => {
    const sw = retiredAsset(new Request("https://66ksiag.pl/sw.js"));
    expect(sw.status).toBe(200);
    expect(sw.headers.get("content-type")).toContain("javascript");
    const body = await sw.text();
    expect(body).toContain("self.registration.unregister()");
    expect(body).toContain("ksiag-v\\d+");
    expect(body).toContain("ksiag-scourby-mp3-v1");
    expect(body).not.toContain("addAll");

    const edition = retiredAsset(new Request("https://66ksiag.pl/bg/1879/manifest.json"));
    expect(edition).toBeNull();
  });

  it("does not serve a web app manifest", () => {
    const manifest = retiredAsset(new Request("https://66ksiag.pl/manifest.webmanifest"));
    expect(manifest.status).toBe(404);
    expect(retiredAsset(new Request("https://66ksiag.pl/manifest.webmanifest/"))?.status).toBe(404);
  });

  it("redirects short book aliases to /czytaj/", async () => {
    const env = fakeEnv();
    const res = await worker.fetch(new Request("https://66ksiag.pl/j/3/16"), env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://66ksiag.pl/czytaj/43-joh/3/16");

    const chap = await worker.fetch(new Request("https://66ksiag.pl/jan/3"), env);
    expect(chap.status).toBe(302);
    expect(chap.headers.get("location")).toBe("https://66ksiag.pl/czytaj/43-joh/3");
  });
});
