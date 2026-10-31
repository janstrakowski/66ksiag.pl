import { describe, expect, it } from "vitest";
import { handleAudio, retiredAsset } from "../../worker/src/index.ts";

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

  it("serves KJV MP3s and byte ranges from R2 AUDIO binding", async () => {
    const sample = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const AUDIO = {
      async head(key) {
        if (key !== "kjv/1769/01-gen/1.mp3") return null;
        return { size: sample.byteLength, httpEtag: '"etag-1"' };
      },
      async get(key, options) {
        if (key !== "kjv/1769/01-gen/1.mp3") return null;
        const start = options?.range?.offset ?? 0;
        const len = options?.range?.length ?? sample.byteLength - start;
        const slice = sample.subarray(start, start + len);
        return {
          size: sample.byteLength,
          httpEtag: '"etag-1"',
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(slice);
              controller.close();
            },
          }),
        };
      },
    };
    const env = { ASSETS: { fetch: async () => new Response("fallback") }, AUDIO };

    const full = await handleAudio(
      new Request("https://66ksiag.pl/kjv/1769/01-gen/1.mp3"),
      env,
      "/kjv/1769/01-gen/1.mp3"
    );
    expect(full?.status).toBe(200);
    expect(full?.headers.get("content-type")).toBe("audio/mpeg");
    expect(full?.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(sample);

    const ranged = await handleAudio(
      new Request("https://66ksiag.pl/kjv/1769/01-gen/1.mp3", {
        headers: { range: "bytes=2-5" },
      }),
      env,
      "/kjv/1769/01-gen/1.mp3"
    );
    expect(ranged?.status).toBe(206);
    expect(ranged?.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4, 5]));
  });
});
