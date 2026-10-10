import { describe, expect, it } from "vitest";
import { handleSync } from "../../worker/src/index.ts";

function memoryKv() {
  const map = new Map();
  return {
    async get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      return hit.slice().buffer;
    },
    async put(key, value) {
      map.set(key, new Uint8Array(value));
    },
    size() {
      return map.size;
    },
  };
}

const ID = "ab".repeat(16);

function envWith(kv) {
  return { SYNC: kv };
}

describe("sync endpoint", () => {
  it("stores one small blob and reads it back", async () => {
    const kv = memoryKv();
    const body = new Uint8Array(44).fill(7);
    const put = await handleSync(
      new Request(`https://66ksiag.pl/api/sync/${ID}`, { method: "PUT", body }),
      envWith(kv),
      ["api", "sync", ID]
    );
    expect(put.status).toBe(204);
    const got = await handleSync(
      new Request(`https://66ksiag.pl/api/sync/${ID}`),
      envWith(kv),
      ["api", "sync", ID]
    );
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(body);
    expect(kv.size()).toBe(1);
  });

  it("rejects a payload bigger than 64 bytes", async () => {
    const kv = memoryKv();
    const res = await handleSync(
      new Request(`https://66ksiag.pl/api/sync/${ID}`, {
        method: "PUT",
        body: new Uint8Array(65),
      }),
      envWith(kv),
      ["api", "sync", ID]
    );
    expect(res.status).toBe(413);
    expect(kv.size()).toBe(0);
  });

  it("rejects a payload too small to be a sealed record", async () => {
    const kv = memoryKv();
    const res = await handleSync(
      new Request(`https://66ksiag.pl/api/sync/${ID}`, {
        method: "PUT",
        body: new Uint8Array(8),
      }),
      envWith(kv),
      ["api", "sync", ID]
    );
    expect(res.status).toBe(400);
    expect(kv.size()).toBe(0);
  });

  it("404s an empty slot and 400s a bad id", async () => {
    const kv = memoryKv();
    const missing = await handleSync(
      new Request(`https://66ksiag.pl/api/sync/${ID}`),
      envWith(kv),
      ["api", "sync", ID]
    );
    expect(missing.status).toBe(404);
    const bad = await handleSync(
      new Request("https://66ksiag.pl/api/sync/nope"),
      envWith(kv),
      ["api", "sync", "nope"]
    );
    expect(bad.status).toBe(400);
  });

  it("ignores paths that are not the sync slot", async () => {
    const res = await handleSync(
      new Request("https://66ksiag.pl/czytaj/01-gen/1"),
      envWith(memoryKv()),
      ["czytaj", "01-gen", "1"]
    );
    expect(res).toBeNull();
  });
});
