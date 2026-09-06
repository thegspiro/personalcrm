import { describe, expect, it } from "vitest";
import { splitName } from "@/lib/names";

describe("splitName", () => {
  it("puts a single word in the first name and leaves the surname empty", () => {
    expect(splitName("Bob")).toEqual({ firstName: "Bob", lastName: "" });
  });

  it("splits two words on the space", () => {
    expect(splitName("Bob Ellis")).toEqual({ firstName: "Bob", lastName: "Ellis" });
  });

  it("keeps everything after the first word together", () => {
    // "Maria del Carmen" is one surname, not a middle name and a surname, and
    // splitting on the last space would file her under "Carmen".
    expect(splitName("Maria del Carmen")).toEqual({
      firstName: "Maria",
      lastName: "del Carmen",
    });
  });

  it("ignores surrounding and repeated whitespace", () => {
    expect(splitName("  Bob   Ellis  ")).toEqual({ firstName: "Bob", lastName: "Ellis" });
  });

  it("returns empty halves for an empty name rather than throwing", () => {
    expect(splitName("   ")).toEqual({ firstName: "", lastName: "" });
  });
});
