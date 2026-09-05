import { describe, expect, it } from "vitest";
import {
  distanceBetween,
  formatDistance,
  formatStoredKm,
  haversineKm,
  isUnit,
  pointOf,
  readCoordinate,
  unitOf,
  withDistance,
} from "@/lib/geo";

/** Prisma hands back a `Decimal`, which is an object with a string form. */
function decimal(value: string) {
  return { toString: () => value };
}

describe("readCoordinate", () => {
  it("reads numbers, strings and Prisma decimals alike", () => {
    expect(readCoordinate(51.5072)).toBe(51.5072);
    expect(readCoordinate("51.5072")).toBe(51.5072);
    expect(readCoordinate(decimal("-0.1276"))).toBe(-0.1276);
  });

  it("treats blank as absent rather than as zero", () => {
    // `Number("")` is 0, which is a real coordinate — and off the coast of
    // Africa. A blank field must not place anybody there.
    expect(readCoordinate("")).toBeNull();
    expect(readCoordinate("   ")).toBeNull();
    expect(readCoordinate(null)).toBeNull();
    expect(readCoordinate(undefined)).toBeNull();
    expect(readCoordinate("not a number")).toBeNull();
    expect(readCoordinate(Number.NaN)).toBeNull();
    // `Number(false)` is also 0.
    expect(readCoordinate(false)).toBeNull();
  });
});

describe("pointOf", () => {
  it("takes a whole pair", () => {
    expect(pointOf({ latitude: "51.5072", longitude: "-0.1276" })).toEqual({
      lat: 51.5072,
      lon: -0.1276,
    });
  });

  it("refuses half a pair", () => {
    // Half a pair is the hazard the schema comment warns about: a latitude
    // alone puts a place on the prime meridian rather than nowhere.
    expect(pointOf({ latitude: "51.5072" })).toBeNull();
    expect(pointOf({ longitude: "-0.1276" })).toBeNull();
    expect(pointOf({ latitude: "51.5072", longitude: "" })).toBeNull();
  });

  it("refuses null island and out-of-range values", () => {
    expect(pointOf({ latitude: 0, longitude: 0 })).toBeNull();
    expect(pointOf({ latitude: 91, longitude: 0.1 })).toBeNull();
    expect(pointOf({ latitude: 10, longitude: 181 })).toBeNull();
    // A genuine coordinate that happens to have a zero half is still a place.
    expect(pointOf({ latitude: 51.5, longitude: 0 })).toEqual({ lat: 51.5, lon: 0 });
  });

  it("reads nothing out of nothing", () => {
    expect(pointOf(null)).toBeNull();
    expect(pointOf(undefined)).toBeNull();
    expect(pointOf({})).toBeNull();
  });
});

describe("haversineKm", () => {
  it("measures a known pair", () => {
    // London to Paris is about 344 km.
    const km = haversineKm({ lat: 51.5072, lon: -0.1276 }, { lat: 48.8566, lon: 2.3522 });
    expect(km).toBeGreaterThan(340);
    expect(km).toBeLessThan(348);
  });

  it("is zero between a point and itself", () => {
    // The floating-point overshoot in `sqrt` makes an unguarded `asin` return
    // NaN here rather than 0.
    const point = { lat: 40.7128, lon: -74.006 };
    expect(haversineKm(point, point)).toBe(0);
  });

  it("is symmetric", () => {
    const a = { lat: 34.0522, lon: -118.2437 };
    const b = { lat: 40.7128, lon: -74.006 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
});

describe("distanceBetween", () => {
  const london = { lat: 51.5072, lon: -0.1276 };
  const paris = { lat: 48.8566, lon: 2.3522 };

  it("converts to the unit asked for", () => {
    const km = distanceBetween(london, paris, "km");
    const mi = distanceBetween(london, paris, "mi");
    expect(km?.unit).toBe("km");
    expect(mi?.unit).toBe("mi");
    expect(mi!.value).toBeCloseTo(km!.value / 1.609344, 6);
  });

  it("says where the number came from", () => {
    // The seam a routing provider would fill: callers render "away" differently
    // from "by car", so the difference has to survive to the component.
    expect(distanceBetween(london, paris, "mi")?.source).toBe("straight-line");
  });

  it("is null when either end is missing", () => {
    expect(distanceBetween(null, paris, "mi")).toBeNull();
    expect(distanceBetween(london, null, "mi")).toBeNull();
    expect(distanceBetween(null, null, "mi")).toBeNull();
  });
});

describe("formatDistance", () => {
  it("keeps a decimal only where it changes the answer", () => {
    expect(formatDistance({ value: 0.42, unit: "mi", source: "straight-line" })).toBe("0.4 mi");
    expect(formatDistance({ value: 9.96, unit: "km", source: "straight-line" })).toBe("10 km");
    expect(formatDistance({ value: 23.4, unit: "mi", source: "straight-line" })).toBe("23 mi");
  });

  it("renders nothing for nothing", () => {
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance(undefined)).toBeNull();
    expect(formatDistance({ value: Number.NaN, unit: "mi", source: "straight-line" })).toBeNull();
  });
});

describe("withDistance", () => {
  const origin = { lat: 51.5072, lon: -0.1276 };
  const rows = [
    { id: "far", latitude: "48.8566", longitude: "2.3522" },
    { id: "unplaced", latitude: null, longitude: null },
    { id: "near", latitude: "51.5194", longitude: "-0.1270" },
  ];

  it("annotates without reordering by default", () => {
    const result = withDistance(rows, origin, "mi", pointOf);
    expect(result.map((row) => row.id)).toEqual(["far", "unplaced", "near"]);
    expect(result[1].distance).toBeNull();
  });

  it("sorts nearest first and leaves the unplaced behind", () => {
    // Unplaced rows must not sort to the top as zero, and must not vanish —
    // a plan with no coordinates is still a plan.
    const result = withDistance(rows, origin, "mi", pointOf, { sort: true });
    expect(result.map((row) => row.id)).toEqual(["near", "far", "unplaced"]);
  });

  it("leaves everything alone when there is no origin", () => {
    const result = withDistance(rows, null, "mi", pointOf, { sort: true });
    expect(result.map((row) => row.id)).toEqual(["far", "unplaced", "near"]);
    expect(result.every((row) => row.distance === null)).toBe(true);
  });
});

describe("formatStoredKm", () => {
  it("reads a stored kilometre figure in the account's unit", () => {
    // `RomanticProfile.distanceKm` is stored in km whatever the account reads
    // distances in. It used to render a hardcoded "km", which contradicted the
    // preference the moment one existed.
    expect(formatStoredKm(20, "km")).toBe("20 km");
    expect(formatStoredKm(20, "mi")).toBe("12 mi");
    expect(formatStoredKm(5, "mi")).toBe("3.1 mi");
  });

  it("renders nothing for nothing", () => {
    expect(formatStoredKm(null, "mi")).toBeNull();
    expect(formatStoredKm(undefined, "mi")).toBeNull();
    expect(formatStoredKm(Number.NaN, "mi")).toBeNull();
  });

  it("keeps a zero, which is a real answer", () => {
    // "They live on my street" is a distance, unlike a blank field.
    expect(formatStoredKm(0, "mi")).toBe("0 mi");
  });
});

describe("unitOf", () => {
  it("falls back rather than trusting whatever the column holds", () => {
    expect(unitOf("km")).toBe("km");
    expect(unitOf("mi")).toBe("mi");
    // A varchar can hold anything a restore puts in it.
    expect(unitOf("furlongs")).toBe("mi");
    expect(unitOf(null)).toBe("mi");
    expect(unitOf(undefined)).toBe("mi");
  });
});

describe("isUnit", () => {
  it("accepts only the two units", () => {
    expect(isUnit("mi")).toBe(true);
    expect(isUnit("km")).toBe(true);
    expect(isUnit("furlongs")).toBe(false);
    expect(isUnit(null)).toBe(false);
  });
});
