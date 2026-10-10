import { beforeEach, describe, expect, it } from "vitest";
import {
  clearEditionChoice,
  EDITIONS,
  findEdition,
  loadEditionChoice,
  saveEditionChoice,
} from "../../web/editions.js";

beforeEach(() => localStorage.clear());

describe("editions storage", () => {
  it("findEdition by id", () => {
    expect(findEdition("kjv-1769")?.short).toBe("KJV");
    expect(findEdition("nope")).toBeNull();
  });

  it("save/load/clear choice", () => {
    expect(loadEditionChoice()).toBeNull();
    saveEditionChoice(EDITIONS[1]);
    expect(loadEditionChoice()?.id).toBe("kjv-1769");
    clearEditionChoice();
    expect(loadEditionChoice()).toBeNull();
  });

  it("ignores unknown saved id", () => {
    localStorage.setItem("ksiag-edition-v1", JSON.stringify({ id: "ghost" }));
    expect(loadEditionChoice()).toBeNull();
  });

  it("ignores corrupt JSON", () => {
    localStorage.setItem("ksiag-edition-v1", "%%%");
    expect(loadEditionChoice()).toBeNull();
  });
});
