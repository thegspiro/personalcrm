import { describe, expect, it } from "vitest";
import {
  GEO_PROVIDERS,
  geoProviderById,
  isPrivateHost,
  isRateLimited,
  minIntervalFor,
  readNominatim,
  readPhoton,
  toCandidateView,
  typeaheadAllowed,
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

  it("never lets an endpoint we cannot edit be queried while typing", () => {
    // A pinned entry is a public service under somebody else's policy. If one
    // is ever added that permits typing, this asks for it to be said out loud
    // rather than inherited from a default.
    for (const entry of GEO_PROVIDERS.filter((provider) => !provider.baseUrlEditable)) {
      expect(
        typeaheadAllowed({ provider: entry.id, baseUrl: entry.defaultBaseUrl }),
        `${entry.id} is pinned but permits typing`,
      ).toBe(false);
    }
  });
});

describe("suggesting while you type", () => {
  it("permits the endpoint built for it", () => {
    expect(typeaheadAllowed({ provider: "photon", baseUrl: "https://photon.komoot.io" })).toBe(
      true,
    );
    expect(typeaheadAllowed({ provider: "photon", baseUrl: "http://photon:2322" })).toBe(true);
    expect(typeaheadAllowed({ provider: "custom", baseUrl: "http://localhost:8080" })).toBe(true);
  });

  it("refuses the service whose policy forbids it", () => {
    expect(
      typeaheadAllowed({ provider: "nominatim", baseUrl: "https://nominatim.openstreetmap.org" }),
    ).toBe(false);
  });

  it("refuses it however the public endpoint is reached", () => {
    // The hole the host check exists to close: "custom" can be pointed
    // anywhere, and the table alone would happily permit typing against the
    // OpenStreetMap Foundation's own servers.
    expect(
      typeaheadAllowed({ provider: "custom", baseUrl: "https://nominatim.openstreetmap.org" }),
    ).toBe(false);
  });

  it("refuses a provider it does not recognise", () => {
    expect(
      typeaheadAllowed({
        provider: "not-a-provider" as never,
        baseUrl: "http://localhost:8080",
      }),
    ).toBe(false);
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

describe("the street line a match offers", () => {
  it("builds one from Nominatim's own address parts", () => {
    const [candidate] = readNominatim([
      {
        display_name: "120, Maple Street, Arlington, Virginia, 22201, United States",
        address: { house_number: "120", road: "Maple Street", city: "Arlington" },
      },
    ]);
    expect(candidate.street).toBe("120 Maple Street");
    // `address` keeps meaning the whole display name, which is what the place
    // editor's label has always shown.
    expect(candidate.address).toContain("United States");
  });

  it("offers no street where there is no road", () => {
    // A city or a park is a real match and a useless address line. A bare house
    // number is worse — "120" on its own is not an address.
    const [city] = readNominatim([
      { display_name: "Arlington, Virginia, United States", address: { city: "Arlington" } },
    ]);
    expect(city.street).toBeNull();

    const [orphan] = readNominatim([
      { display_name: "Somewhere", address: { house_number: "120", city: "Arlington" } },
    ]);
    expect(orphan.street).toBeNull();
  });

  it("builds one from Photon's housenumber and street", () => {
    const [candidate] = readPhoton({
      features: [
        {
          properties: { housenumber: "120", street: "Maple Street", city: "Arlington" },
          geometry: { coordinates: [-77.1728, 38.8809] },
        },
      ],
    });
    expect(candidate.street).toBe("120 Maple Street");
  });

  it("offers no street for a Photon result that is only a name", () => {
    const [candidate] = readPhoton({
      features: [
        {
          properties: { name: "Northside Cafe", city: "Arlington" },
          geometry: { coordinates: [-77.1728, 38.8809] },
        },
      ],
    });
    expect(candidate.street).toBeNull();
    // The venue's name still fills `address`, which is the documented asymmetry
    // between the two dialects rather than an accident.
    expect(candidate.address).toBe("Northside Cafe");
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

  it("recognises an endpoint on this machine or this network", () => {
    expect(isPrivateHost("http://localhost:8080")).toBe(true);
    expect(isPrivateHost("http://127.0.0.1:2322")).toBe(true);
    expect(isPrivateHost("http://[::1]:2322")).toBe(true);
    expect(isPrivateHost("http://10.1.2.3")).toBe(true);
    expect(isPrivateHost("http://192.168.1.10:8080")).toBe(true);
    expect(isPrivateHost("http://172.16.0.1")).toBe(true);
    expect(isPrivateHost("http://172.31.255.254")).toBe(true);
    expect(isPrivateHost("http://photon.internal")).toBe(true);
    expect(isPrivateHost("http://photon.local")).toBe(true);
  });

  it("does not mistake a public name for one of your own", () => {
    expect(isPrivateHost("https://photon.komoot.io")).toBe(false);
    // Just outside the private range, and a name that only looks like an
    // address — both are somebody else's.
    expect(isPrivateHost("http://172.32.0.1")).toBe(false);
    expect(isPrivateHost("http://999.1.1.1")).toBe(false);
    expect(isPrivateHost("not a url")).toBe(false);
  });

  it("spaces requests by whose hardware answers them", () => {
    // A second for the service that asks for one, nothing at all for your own
    // box, and a small gap for anything else shared — which typing turns from
    // one request into several.
    expect(minIntervalFor("https://nominatim.openstreetmap.org")).toBe(1_100);
    expect(minIntervalFor("http://localhost:8080")).toBe(0);
    expect(minIntervalFor("https://photon.komoot.io")).toBe(300);
  });
});

describe("crossing into the browser", () => {
  it("carries every field a candidate has", () => {
    // `toCandidateView` is a hand-written whitelist, so the next field added to
    // `GeoCandidate` would silently vanish at the client boundary without this.
    const [candidate] = readPhoton({
      features: [
        {
          properties: { name: "Northside Cafe", city: "Arlington", osm_type: "N", osm_id: 42 },
          geometry: { coordinates: [-77.1728, 38.8809] },
        },
      ],
    });
    expect(Object.keys(toCandidateView(candidate)).sort()).toEqual(Object.keys(candidate).sort());
  });
});
