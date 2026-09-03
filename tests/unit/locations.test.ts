import { describe, expect, it } from "vitest";
import { mapLinkFor, normalizeLocationName } from "@/lib/locations";
import { matchKnownLocation } from "@/lib/quick-parse";

describe("normalizeLocationName", () => {
  it("folds case and repeated whitespace without guessing at fuzzy aliases", () => {
    expect(normalizeLocationName("  Northside   Café ")).toBe("northside café");
    expect(normalizeLocationName("The Alamo")).not.toBe(
      normalizeLocationName("Alamo"),
    );
  });
});

describe("location aliases", () => {
  it("matches an alias while returning the canonical location", () => {
    const result = matchKnownLocation("Dinner at The Local", [
      {
        id: "place-1",
        name: "Northside Cafe",
        locationAliases: [{ value: "The Local" }],
      },
    ]);
    expect(result.place?.location).toMatchObject({
      id: "place-1",
      name: "Northside Cafe",
    });
    expect(result.place?.matchedText).toBe("The Local");
  });
});

describe("mapLinkFor", () => {
  it("prefers the OSM object, which survives a reimport", () => {
    expect(
      mapLinkFor({ osmType: "W", osmId: 12345n, name: "Northside Cafe" }),
    ).toBe("https://www.openstreetmap.org/way/12345");
  });

  it("marks a point rather than searching for the digits", () => {
    // `search?query=38.88,-77.17` searched for a string that merely looked like
    // coordinates, so a correct pair still produced a results page.
    expect(
      mapLinkFor({ latitude: "38.8809", longitude: "-77.1728", name: "Home" }),
    ).toBe(
      "https://www.openstreetmap.org/?mlat=38.8809&mlon=-77.1728#map=17/38.8809/-77.1728",
    );
  });

  it("falls back to the address, then the bare name", () => {
    expect(mapLinkFor({ address: "123 Main St", name: "Northside Cafe" })).toBe(
      "https://www.openstreetmap.org/search?query=123%20Main%20St",
    );
    expect(mapLinkFor({ name: "Northside Cafe" })).toBe(
      "https://www.openstreetmap.org/search?query=Northside%20Cafe",
    );
  });

  it("ignores half a coordinate pair and unparseable values", () => {
    expect(
      mapLinkFor({ latitude: "38.88", longitude: null, name: "Half" }),
    ).toBe("https://www.openstreetmap.org/search?query=Half");
    expect(
      mapLinkFor({ latitude: "north", longitude: "west", name: "Vague" }),
    ).toBe("https://www.openstreetmap.org/search?query=Vague");
  });
});
