import { describe, expect, it } from "vitest";
import { planCopy, t } from "../../web/i18n.js";
import { EDITIONS, findEdition } from "../../web/editions.js";

describe("i18n", () => {
  const bg = findEdition("bg-1879");
  const kjv = findEdition("kjv-1769");

  it("editions exist with expected languages", () => {
    expect(EDITIONS).toHaveLength(2);
    expect(bg.language).toBe("pl");
    expect(kjv.language).toBe("en");
    expect(kjv.audio).toBe(true);
    expect(bg.audio).toBeFalsy();
  });

  it("t() switches PL / EN", () => {
    expect(t(bg).htmlLang).toBe("pl");
    expect(t(kjv).htmlLang).toBe("en");
    expect(t(bg).startRead).toMatch(/Zacznij|czytać/i);
    expect(t(kjv).startRead).toMatch(/Begin|read/i);
    expect(t(bg).homeSourceUrl).toBe("https://github.com/UczenJezusa/biblia-druk-tekst");
    expect(t(bg).homeSourceName).toBe("Uczeń Jezusa");
    expect(t(kjv).homeSourceUrl).toBeUndefined();
  });

  it("eta and quota formatters differ by language", () => {
    expect(t(bg).etaMinutes(6)).toMatch(/ok\.\s*6/);
    expect(t(kjv).etaMinutes(6)).toMatch(/about 6 minutes/i);
    expect(t(bg).quotaChapters(3)).toMatch(/rozdz/);
    expect(t(kjv).quotaChapters(3)).toMatch(/chapters/);
  });

  it("planCopy includes plan-form keys", () => {
    const pl = planCopy(bg);
    const en = planCopy(kjv);
    expect(pl.setPlan).toBe("Ustaw");
    expect(pl.abandonPlan).toBe("Porzuć");
    expect(en.setPlan).toBe("Appoint");
    expect(en.abandonPlan).toBe("Put off");
    expect(pl.notifyOfferYes).toBe("Włącz");
    expect(en.notifyOfferNo).toBe("Not now");
    expect(pl.cloudHint).toMatch(/chmurze/);
    expect(pl.cloudHint).toMatch(/szyfrowane/);
    expect(en.cloudHint).toMatch(/cloud/i);
    expect(en.cloudHint).toMatch(/ciphered/);
    expect(en.blockedSteps).toHaveLength(4);
    expect(pl.blockedSteps).toHaveLength(4);
    expect(en.audioDownloadProgress(4, 1189, 0, "about 2 min left")).toBe(
      "Wanting: 4 / 1189 · about 2 min left",
    );
    expect(en.audioDownloadPartial(4, 1189)).toBe("Wanting: 4 / 1189");
    expect(en.audioDownloadDone(1189)).toBe("Audio is already downloaded.");
    expect(en.audioDownloadResume).toBe("Resume audio");
    expect(pl.audioDownloadPartial(4, 1189)).toBe("Brakujące: 4 / 1189");
    expect(pl.audioDownloadDone()).toBe("Audio jest już pobrane.");
    expect(pl.audioDownloadResume).toBe("Wznów audio");
  });

  it("banner helpers and planPct", () => {
    expect(t(bg).planPct(40)).toMatch(/40%/);
    expect(t(kjv).planPct(40)).toMatch(/40%/);
    expect(t(kjv).bannerBefore + "12" + t(kjv).bannerAfter).toMatch(/12%/);
  });

  it("null edition falls back to PL", () => {
    expect(t(null).htmlLang).toBe("pl");
  });
});
