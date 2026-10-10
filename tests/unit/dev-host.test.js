import { afterEach, describe, expect, it, vi } from "vitest";

describe("isDevHost", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  async function loadWithHost(hostname) {
    vi.stubGlobal("location", { hostname });
    const mod = await import("../../web/dev-host.js");
    return mod.isDevHost();
  }

  it("true for localhost variants", async () => {
    expect(await loadWithHost("localhost")).toBe(true);
    expect(await loadWithHost("127.0.0.1")).toBe(true);
    expect(await loadWithHost("[::1]")).toBe(true);
    expect(await loadWithHost("app.localhost")).toBe(true);
    expect(await loadWithHost("foo.local")).toBe(true);
  });

  it("false for production-like hosts", async () => {
    expect(await loadWithHost("66ksiag.example")).toBe(false);
    expect(await loadWithHost("ksiag.pages.dev")).toBe(false);
  });
});
