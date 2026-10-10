import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { generateToken, syncAuthHeaders, syncMessage } from "../../web/cloud.js";
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

function signedRequest(method, id, headers, body) {
  return new Request(`https://66ksiag.pl/api/sync/${id}`, {
    method,
    headers,
    body: method === "GET" ? undefined : body,
  });
}

describe("sync endpoint", () => {
  it("stores one small blob and reads it back only with the key's signature", async () => {
    const kv = memoryKv();
    const token = generateToken();
    const body = new Uint8Array(44).fill(7);
    const putHeaders = await syncAuthHeaders("PUT", token, body);
    const put = await handleSync(
      signedRequest("PUT", token.idHex, putHeaders, body),
      envWith(kv),
      ["api", "sync", token.idHex]
    );
    expect(put.status).toBe(204);
    const unsigned = await handleSync(
      new Request(`https://66ksiag.pl/api/sync/${token.idHex}`),
      envWith(kv),
      ["api", "sync", token.idHex]
    );
    expect(unsigned.status).toBe(401);
    const getHeaders = await syncAuthHeaders("GET", token, new Uint8Array());
    const got = await handleSync(
      signedRequest("GET", token.idHex, getHeaders),
      envWith(kv),
      ["api", "sync", token.idHex]
    );
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(body);
    expect(kv.size()).toBe(2);
  });

  it("refuses a write signed by a different key", async () => {
    const kv = memoryKv();
    const owner = generateToken();
    const intruder = generateToken();
    intruder.id = owner.id;
    intruder.idHex = owner.idHex;
    const body = new Uint8Array(44).fill(7);
    const putHeaders = await syncAuthHeaders("PUT", owner, body);
    const put = await handleSync(
      signedRequest("PUT", owner.idHex, putHeaders, body),
      envWith(kv),
      ["api", "sync", owner.idHex]
    );
    expect(put.status).toBe(204);
    const other = new Uint8Array(44).fill(9);
    const attackHeaders = await syncAuthHeaders("PUT", intruder, other);
    const attack = await handleSync(
      signedRequest("PUT", owner.idHex, attackHeaders, other),
      envWith(kv),
      ["api", "sync", owner.idHex]
    );
    expect(attack.status).toBe(401);
    const got = await handleSync(
      signedRequest("GET", owner.idHex, await syncAuthHeaders("GET", owner, new Uint8Array())),
      envWith(kv),
      ["api", "sync", owner.idHex]
    );
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(body);
  });

  it("refuses a stale or altered signature", async () => {
    const kv = memoryKv();
    const token = generateToken();
    const body = new Uint8Array(44).fill(3);
    const stale = await syncAuthHeaders("PUT", token, body, 0);
    const old = await handleSync(
      signedRequest("PUT", token.idHex, stale, body),
      envWith(kv),
      ["api", "sync", token.idHex]
    );
    expect(old.status).toBe(401);
    const headers = await syncAuthHeaders("PUT", token, body);
    const tampered = new Uint8Array(body);
    tampered[0] ^= 0xff;
    const changed = await handleSync(
      signedRequest("PUT", token.idHex, headers, tampered),
      envWith(kv),
      ["api", "sync", token.idHex]
    );
    expect(changed.status).toBe(401);
    expect(kv.size()).toBe(0);
  });

  it("agrees with the dev server verifier", async () => {
    const token = generateToken();
    const body = new Uint8Array([1, 2, 3, 4]);
    const headers = await syncAuthHeaders("PUT", token, body, 1_700_000_000);
    const message = syncMessage("PUT", token.idHex, headers["x-sync-time"], headers["x-sync-pub"], body);
    execFileSync("python3", ["scripts/sync_ed25519.py", headers["x-sync-pub"], headers["x-sync-sign"]], {
      input: message,
    });
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
    const token = generateToken();
    const headers = await syncAuthHeaders("GET", token, new Uint8Array());
    const missing = await handleSync(
      signedRequest("GET", token.idHex, headers),
      envWith(kv),
      ["api", "sync", token.idHex]
    );
    expect(missing.status).toBe(404);
    const unsigned = await handleSync(
      new Request(`https://66ksiag.pl/api/sync/${token.idHex}`),
      envWith(kv),
      ["api", "sync", token.idHex]
    );
    expect(unsigned.status).toBe(401);
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
