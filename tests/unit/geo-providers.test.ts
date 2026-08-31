import { describe, expect, it } from "vitest";
import {
  GEO_PROVIDERS,
  geoProviderById,
  isRateLimited,
  readNominatim,
  readPhoton,
} from "@/server/geo/providers";

/**
 * Reading a geocoder's answer.
 *
 * Pure shaping, tested against recorded response shapes — nothing here touches
 * a network, exactly as `ai-providers.test.ts` covers `extractJson` without one.
 */

describe("the provider table", () => {
  it("can point every dialect it speaks at a self-hosted endpoint", () => {
    // The gap this closes: Photon was pinned to the public instance while the
    // only editable entry spoke Nominatim, so a self-hosted Photon could not be
    // reached at all — requests left in the wrong shape and quietly matched
    // nothing. Any future dialect has the same trap waiting for it.
    for (const dialect of new Set(GEO_PROVIDERS.map((entry) => entry.dialect))) {
      const reachable = GEO_PROVIDERS.some(
        (entry) => entry.dialect === dialect && entry.baseUrlEditable,
      );
      expect(reachable, `no self-hostable entry speaks ${dialect}`).toBe(true);
    }
  });

  it("keeps the OpenStreetMap Foundation's own endpoint pinned", () => {
    // It runs on donated servers under a published policy; the address is not
    // something to mistype, and self-hosting Nominatim goes through "custom".
    expect(geoProviderById("nominatim")?.baseUrlEditable).toBe(false);
  });

  it("resolves a known provider and refuses an unknown one", () => {
    expect(geoProviderById("nominatim")?.dialect).toBe("nominatim");
    expect(geoProviderById("photon")?.dialect).toBe("photon");
    expect(geoProviderById("not-a-provider")).toBeNull();
  });
});

describe("reading Nominatim", () => {
  const response = [
    {
      place_id: 987654,
      osm_type: "way",
      osm_id: 123456789,
      lat: "38.8809",
      lon: "-77.1728",
      display_name: "Northside Cafe, Wilson Blvd, Arlington, Virginia, USA",
      address: { city: "Arlington", state: "Virginia", country: "United States" },
    },
  ];

  it("keeps the OSM object and drops place_id", () => {
    const [candidate] = readNominatim(response);
    expect(candidate.osmType).toBe("W");
    expect(candidate.osmId).toBe("123456789");
    // `place_id` is internal to one Nominatim instance and does not survive a
    // reimport, so storing it would give us a reference that quietly rots.
    expect(JSON.stringify(candidate)).not.toContain("987654");
  });

  it("reads the address parts and the coordinates", () => {
    const [candidate] = readNominatim(response);
    expect(candidate.city).toBe("Arlington");
    expect(candidate.region).toBe("Virginia");
    expect(candidate.country).toBe("United States");
    expect(candidate.latitude).toBe("38.8809");
    expect(candidate.longitude).toBe("-77.1728");
  });

  it("falls back through town and village for somewhere smaller", () => {
    const [candidate] = readNominatim([
      { display_name: "The Green", osm_type: "node", osm_id: 1, address: { village: "Ambleside" } },
    ]);
    expect(candidate.city).toBe("Ambleside");
  });

  it("returns nothing for a shape it does not recognise", () => {
    expect(readNominatim(null)).toEqual([]);
    expect(readNominatim({ error: "nope" })).toEqual([]);
    expect(readNominatim([{ osm_type: "way" }])).toEqual([]);
  });
});

describe("reading Photon", () => {
  const response = {
    features: [
      {
        geometry: { coordinates: [-77.1728, 38.8809] },
        properties: {
          osm_type: "N",
          osm_id: 42,
          name: "Northside Cafe",
          housenumber: "1500",
          street: "Wilson Blvd",
          city: "Arlington",
          state: "Virginia",
          country: "United States",
        },
      },
    ],
  };

  it("reads GeoJSON coordinates the right way round", () => {
    const [candidate] = readPhoton(response);
    // GeoJSON is [longitude, latitude] — the opposite of how they are written
    // everywhere else, and swapping them puts this cafe in the sea.
    expect(candidate.latitude).toBe("38.8809");
    expect(candidate.longitude).toBe("-77.1728");
  });

  it("keeps the OSM object", () => {
    const [candidate] = readPhoton(response);
    expect(candidate.osmType).toBe("N");
    expect(candidate.osmId).toBe("42");
  });

  it("returns nothing for a shape it does not recognise", () => {
    expect(readPhoton(null)).toEqual([]);
    expect(readPhoton({ features: "nope" })).toEqual([]);
    expect(readPhoton({ features: [{ properties: {} }] })).toEqual([]);
  });
});

describe("respecting a shared endpoint", () => {
  it("gates the public Nominatim, whose policy caps an app at one request a second", () => {
    expect(isRateLimited("https://nominatim.openstreetmap.org")).toBe(true);
    expect(isRateLimited("https://Nominatim.OpenStreetMap.org/")).toBe(true);
  });

  it("does not gate an endpoint you run yourself", () => {
    // Your own box is nobody else's to protect, and a queue there would only
    // make the button feel slow.
    expect(isRateLimited("http://localhost:8080")).toBe(false);
    expect(isRateLimited("https://photon.komoot.io")).toBe(false);
    expect(isRateLimited("http://nominatim.internal.example")).toBe(false);
  });

  it("treats an unparseable endpoint as ungated rather than throwing", () => {
    expect(isRateLimited("not a url")).toBe(false);
  });
});
