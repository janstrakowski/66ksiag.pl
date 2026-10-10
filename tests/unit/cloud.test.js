import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYNC_MAX_BYTES,
  decodePlan,
  encodePlan,
  formatToken,
  generateToken,
  joinToken,
  loadCloud,
  schedulePush,
  minutesSinceEpoch,
  openSeal,
  parseToken,
  pull,
  qrSvg,
  saveCloud,
  seal,
  syncAuthHeaders,
} from "../../web/cloud.js";
import {
  defaultPlan,
  loadPlan as loadStoredPlan,
  savePlan as saveStoredPlan,
  todayKey,
} from "../../web/plan.js";
import { miniBooks } from "../fixtures/books.js";

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

function samplePlan() {
  const plan = defaultPlan();
  plan.enabled = true;
  plan.goal = "range";
  plan.mode = "time";
  plan.fromBook = "01-gen";
  plan.fromChapter = 1;
  plan.toBook = "02-exo";
  plan.toChapter = 2;
  plan.chaptersPerDay = 7;
  plan.minutesPerDay = 40;
  plan.cursor = 4;
  plan.day = todayKey();
  plan.readToday = ["01-gen/3", "02-exo/1"];
  plan.notifications = true;
  plan.startNotifiedDay = "2026-01-01";
  return plan;
}

describe("cloud token", () => {
  it("splits 32 bytes into a slot id and an AES key", () => {
    const token = generateToken();
    expect(token.bytes).toHaveLength(32);
    expect(token.id).toHaveLength(16);
    expect(token.key).toHaveLength(16);
    expect(token.idHex).toHaveLength(32);
    expect(token.idHex).toMatch(/^[0-9a-f]{32}$/);
    expect([...token.id]).toEqual([...token.bytes.slice(0, 16)]);
    expect([...token.key]).toEqual([...token.bytes.slice(16)]);
  });

  it("round-trips grouped text and letter aliases", () => {
    const zeros = parseToken("0".repeat(52));
    expect(zeros).not.toBeNull();
    expect([...zeros.id].every((b) => b === 0)).toBe(true);
    expect([...zeros.key].every((b) => b === 0)).toBe(true);

    const token = generateToken();
    const grouped = formatToken(token.canonical).replace(/0/g, "O").replace(/1/g, "I");
    const again = parseToken(`https://66ksiag.pl/plan#${grouped}`);
    expect(again.canonical).toBe(token.canonical);
    expect(again.idHex).toBe(token.idHex);
  });

  it("rejects a short code", () => {
    expect(parseToken("ABCD")).toBeNull();
  });
});

describe("plan codec", () => {
  it("round-trips the reading plan and both bookmarks", () => {
    const plan = samplePlan();
    const updated = minutesSinceEpoch();
    const plain = encodePlan(plan, updated, {
      "bg-1879": { book: "01-gen", chapter: 4 },
      "kjv-1769": { book: "40-mat", chapter: 2 },
    });
    expect(plain).toHaveLength(24);
    const decoded = decodePlan(plain, miniBooks(), {
      ...defaultPlan(),
      notifications: false,
      startNotifiedDay: "keep-me",
    });
    expect(decoded.updatedMin).toBe(updated);
    expect(decoded.plan.enabled).toBe(true);
    expect(decoded.plan.goal).toBe("range");
    expect(decoded.plan.mode).toBe("time");
    expect(decoded.plan.chaptersPerDay).toBe(7);
    expect(decoded.plan.minutesPerDay).toBe(40);
    expect(decoded.plan.fromBook).toBe("01-gen");
    expect(decoded.plan.toBook).toBe("02-exo");
    expect(decoded.plan.cursor).toBe(4);
    expect(decoded.plan.readToday).toEqual(["01-gen/3", "02-exo/1"]);
    expect(decoded.plan.notifications).toBe(false);
    expect(decoded.plan.startNotifiedDay).toBe("keep-me");
    expect(decoded.places["bg-1879"]).toEqual({ book: "01-gen", chapter: 4 });
    expect(decoded.places["kjv-1769"]).toEqual({ book: "40-mat", chapter: 2 });
  });

  it("drops yesterday's chapter list", () => {
    const plan = samplePlan();
    const d = new Date();
    d.setDate(d.getDate() - 1);
    plan.day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const decoded = decodePlan(encodePlan(plan, 10), miniBooks(), defaultPlan());
    expect(decoded.plan.day).toBe(todayKey());
    expect(decoded.plan.readToday).toEqual([]);
    expect(decoded.plan.cursor).toBe(4);
  });

  it("seals to a blob the server will accept, and the key stays out of it", async () => {
    const token = generateToken();
    const plain = encodePlan(samplePlan(), 42);
    const blob = await seal(plain, token.key, token.id);
    expect(blob.byteLength).toBe(52);
    expect(blob.byteLength).toBeLessThanOrEqual(SYNC_MAX_BYTES);
    const opened = await openSeal(blob, token.key, token.id);
    expect([...opened]).toEqual([...plain]);
    const wrong = new Uint8Array(token.key);
    wrong[0] ^= 0xff;
    expect(await openSeal(blob, wrong, token.id)).toBeNull();
    const otherId = new Uint8Array(token.id);
    otherId[0] ^= 0xff;
    expect(await openSeal(blob, token.key, otherId)).toBeNull();
  });
});

describe("cloud sync", () => {
  it("joins an existing blob and keeps device notifications", async () => {
    const token = generateToken();
    const remotePlan = samplePlan();
    remotePlan.notifications = false;
    const plain = encodePlan(remotePlan, 500);
    const blob = await seal(plain, token.key, token.id);
    const local = defaultPlan();
    local.notifications = true;
    local.cursor = 1;
    saveStoredPlan(local);

    const seen = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, opts) => {
        seen.push(opts?.headers || {});
        return new Response(blob, { status: 200 });
      })
    );

    const status = await joinToken(formatToken(token.canonical), miniBooks());
    expect(seen[0]["x-sync-pub"]).toMatch(/^[0-9a-f]{64}$/);
    expect(seen[0]["x-sync-sign"]).toMatch(/^[0-9a-f]{128}$/);
    expect(status).toBe("joined");
    const stored = loadStoredPlan();
    expect(stored.cursor).toBe(4);
    expect(stored.notifications).toBe(true);
    expect(stored.readToday).toEqual(["01-gen/3", "02-exo/1"]);
    expect(loadCloud().token).toBe(token.canonical);
    expect(loadCloud().enabled).toBe(true);
  });

  it("uploads the local plan when the slot is empty", async () => {
    const token = generateToken();
    const local = samplePlan();
    saveStoredPlan(local);
    saveCloud({ enabled: false, token: "", updatedMin: 3 });
    const puts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, opts) => {
        if (!opts || opts.method !== "PUT") return new Response(null, { status: 404 });
        puts.push({ body: new Uint8Array(await opts.body), headers: opts.headers });
        return new Response(null, { status: 204 });
      })
    );
    const status = await joinToken(token.canonical, miniBooks());
    expect(status).toBe("uploaded");
    expect(puts).toHaveLength(1);
    expect(puts[0].body.byteLength).toBe(52);
    expect(puts[0].body.byteLength).toBeLessThanOrEqual(SYNC_MAX_BYTES);
    expect(puts[0].headers["x-sync-sign"]).toMatch(/^[0-9a-f]{128}$/);
    const expected = await syncAuthHeaders(
      "PUT",
      token,
      puts[0].body,
      Number(puts[0].headers["x-sync-time"])
    );
    expect(puts[0].headers["x-sync-sign"]).toBe(expected["x-sync-sign"]);
    const opened = await openSeal(puts[0].body, token.key, token.id);
    const decoded = decodePlan(opened, miniBooks(), defaultPlan());
    expect(decoded.plan.cursor).toBe(4);
  });

  it("keeps a newer local stamp while sync is off, without uploading", () => {
    const token = generateToken();
    saveCloud({ enabled: false, token: token.canonical, updatedMin: 10 });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    schedulePush();
    expect(loadCloud().updatedMin).toBeGreaterThan(10);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pull takes the newer remote copy", async () => {
    const token = generateToken();
    saveCloud({ enabled: true, token: token.canonical, updatedMin: 10 });
    saveStoredPlan(samplePlan());
    const remote = samplePlan();
    remote.cursor = 2;
    remote.readToday = [];
    const blob = await seal(encodePlan(remote, 80), token.key, token.id);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(blob, { status: 200 })));
    const status = await pull(miniBooks());
    expect(status).toBe("remote");
    expect(loadStoredPlan().cursor).toBe(2);
    expect(loadCloud().updatedMin).toBe(80);
  });
});

describe("pairing mark", () => {
  it("draws a QR without writing the code into the markup", async () => {
    const token = generateToken();
    const svg = await qrSvg(`https://66ksiag.pl/plan#${token.canonical}`);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain(token.canonical);
  });
});
