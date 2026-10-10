import { beforeEach, describe, expect, it, vi } from "vitest";

describe("notify helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("ensureNotifyPermission returns unsupported without Notification", async () => {
    vi.stubGlobal("Notification", undefined);
    const { ensureNotifyPermission } = await import("../../web/notify.js");
    expect(await ensureNotifyPermission()).toBe("unsupported");
  });

  it("notifyStartReading uses minutesWithRange when provided", async () => {
    const show = vi.fn(async () => true);
    vi.stubGlobal("Notification", {
      permission: "granted",
      requestPermission: async () => "granted",
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: Promise.resolve({ showNotification: show }),
      },
    });
    const { notifyStartReading } = await import("../../web/notify.js");
    const ok = await notifyStartReading(
      { done: false, started: false, minutes: 6, range: "Gen I–II" },
      {
        startRead: "Begin",
        htmlLang: "en",
        minutesWithRange: (m, r) => `${m} minutes · ${r}`,
      }
    );
    expect(ok).toBe(true);
    expect(show).toHaveBeenCalled();
    const [, opts] = show.mock.calls[0];
    expect(opts.body).toBe("6 minutes · Gen I–II");
  });

  it("notifyProgress uses banner strings", async () => {
    const show = vi.fn(async () => true);
    vi.stubGlobal("Notification", { permission: "granted" });
    vi.stubGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve({ showNotification: show }) },
    });
    const { notifyProgress } = await import("../../web/notify.js");
    await notifyProgress(40, {
      planNav: "Portion",
      bannerBefore: "Ye have read ",
      bannerAfter: "% of this day’s portion.",
      htmlLang: "en",
    });
    expect(show.mock.calls[0][1].body).toContain("40%");
  });
});
