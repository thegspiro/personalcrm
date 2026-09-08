import { describe, expect, it } from "vitest";
import { LOVE_LANGUAGES, readLoveLanguages } from "@/lib/love-languages";

describe("love languages", () => {
  it("keeps the ones it recognises", () => {
    expect(readLoveLanguages(["Quality time", "Physical touch"])).toEqual([
      "Quality time",
      "Physical touch",
    ]);
  });

  it("returns them in the canonical order, not the submitted one", () => {
    expect(readLoveLanguages(["Receiving gifts", "Words of affirmation"])).toEqual([
      "Words of affirmation",
      "Receiving gifts",
    ]);
  });

  it("drops anything it does not recognise", () => {
    expect(readLoveLanguages(["Quality time", "Interpretive dance", "", 7])).toEqual([
      "Quality time",
    ]);
  });

  // A checkbox group cannot send the same value twice; a direct POST can.
  it("de-duplicates", () => {
    expect(readLoveLanguages(["Acts of service", "Acts of service"])).toEqual([
      "Acts of service",
    ]);
  });

  it.each([null, undefined, "Quality time", 7, { a: 1 }])("reads %s as nothing", (value) => {
    expect(readLoveLanguages(value)).toEqual([]);
  });

  it("accepts every canonical value", () => {
    expect(readLoveLanguages([...LOVE_LANGUAGES])).toEqual([...LOVE_LANGUAGES]);
  });
});
