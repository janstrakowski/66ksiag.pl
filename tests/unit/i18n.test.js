import { describe, expect, it } from "vitest";
import { t } from "../../web/i18n.js";
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

  it("eta and audio strings differ by language", () => {
    expect(t(bg).etaMinutes(6)).toMatch(/ok\.\s*6/);
    expect(t(kjv).etaMinutes(6)).toMatch(/about 6 minutes/i);
    expect(t(kjv).audioListen).toBe("Hear");
    expect(t(bg).audioListen).toBe("Słuchaj");
    expect(t(kjv).audioDownload).toBeUndefined();
    expect(t(bg).audioDownload).toBeUndefined();
  });

  it("null edition falls back to PL", () => {
    expect(t(null).htmlLang).toBe("pl");
  });
});
