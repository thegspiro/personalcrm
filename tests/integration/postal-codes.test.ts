import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

/**
 * Importing a country's postal codes.
 *
 * The interesting parts are all about what a *second* import does. A re-import
 * is how a country is brought up to date, so it has to replace rather than
 * accumulate — and it has to leave every other country alone while doing it.
 * Neither is visible from a single import, which is why both are tested against
 * a real database rather than reasoned about.
 *
 * Stored per installation rather than per account, so the guard is a role check
 * rather than an owner scope — the same unusual shape the address lookup's
 * endpoint has, and worth pinning down for the same reason.
 */

const state = vi.hoisted(() => ({ userId: "", role: "ADMIN" as "ADMIN" | "MEMBER" }));

vi.mock("@/server/db/client", async () => ({ prisma: (await import("./db")).prisma }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: state.userId, role: state.role },
    timezone: "America/New_York",
    prefs: {},
  }),
}));

const { importPostalCodes, clearPostalCodes, lookupPostalCode } = await import(
  "@/server/actions/postal-codes"
);
const { findPostalPlaces, listPostalSources, hasPostalCodes } = await import(
  "@/server/queries/postal-codes"
);

/** A country file as GeoNames publishes it: twelve tab-separated columns. */
function file(...lines: string[]): FormData {
  const form = new FormData();
  form.set("file", new File([lines.join("\n")], "codes.txt", { type: "text/plain" }));
  return form;
}

const US_BEVERLY = "US\t90210\tBeverly Hills\tCalifornia\tCA\tLos Angeles\t037\t\t\t34.09\t-118.4\t4";
const US_NEW_YORK = "US\t10001\tNew York\tNew York\tNY\tNew York\t061\t\t\t40.74\t-73.99\t4";
const GB_LONDON = "GB\tSW1A 1AA\tLondon\tEngland\tENG\t\t\t\t\t51.50\t-0.14\t4";

describe.skipIf(!hasTestDatabase)("importing postal codes", () => {
  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    state.userId = user.id;
    state.role = "ADMIN";
  });

  afterAll(() => prisma.$disconnect());

  it("stores a country and says what it stored", async () => {
    const result = await importPostalCodes(file(US_BEVERLY, US_NEW_YORK));
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ country: "US", rows: 2, skipped: 0 });

    expect(await listPostalSources()).toMatchObject([{ country: "US", rows: 2 }]);
    expect(await hasPostalCodes()).toBe(true);
  });

  it("replaces a country on re-import rather than piling a second copy on it", async () => {
    await importPostalCodes(file(US_BEVERLY, US_NEW_YORK));
    // The second file has dropped one code and kept the other, which is what a
    // refreshed download looks like.
    await importPostalCodes(file(US_BEVERLY));

    expect(await prisma.postalCode.count({ where: { country: "US" } })).toBe(1);
    expect(await listPostalSources()).toMatchObject([{ country: "US", rows: 1 }]);
    expect(await findPostalPlaces("10001")).toEqual([]);
  });

  it("leaves every other country alone while replacing one", async () => {
    await importPostalCodes(file(US_BEVERLY));
    await importPostalCodes(file(GB_LONDON));
    await importPostalCodes(file(US_NEW_YORK));

    expect(await findPostalPlaces("SW1A1AA")).toMatchObject([{ country: "GB", place: "London" }]);
    expect(await listPostalSources()).toMatchObject([
      { country: "GB", rows: 1 },
      { country: "US", rows: 1 },
    ]);
  });

  it("is not a member's to import or to clear", async () => {
    await importPostalCodes(file(US_BEVERLY));

    state.role = "MEMBER";
    expect((await importPostalCodes(file(US_NEW_YORK))).ok).toBe(false);
    expect((await clearPostalCodes(formFor("US"))).ok).toBe(false);

    state.role = "ADMIN";
    // Unchanged: a member's post must not reach the stored data at all.
    expect(await prisma.postalCode.count()).toBe(1);
  });

  it("removes a country and leaves nothing behind", async () => {
    await importPostalCodes(file(US_BEVERLY));
    await importPostalCodes(file(GB_LONDON));

    expect((await clearPostalCodes(formFor("US"))).ok).toBe(true);
    expect(await prisma.postalCode.count({ where: { country: "US" } })).toBe(0);
    expect(await listPostalSources()).toMatchObject([{ country: "GB" }]);
    // The other country still answers, so the removal was a removal and not a
    // truncation.
    expect(await findPostalPlaces("SW1A1AA")).toHaveLength(1);
  });

  it("refuses a file holding more than one country", async () => {
    const result = await importPostalCodes(file(US_BEVERLY, GB_LONDON));
    expect(result.ok).toBe(false);
    // Names what it found, because the file somebody reaches for by mistake is
    // allCountries.txt and "that was wrong" would not say why.
    expect(result.error).toContain("GB, US");
    expect(await prisma.postalCode.count()).toBe(0);
  });

  it("refuses a file with no postal codes in it", async () => {
    expect((await importPostalCodes(file("this is not a postal code file"))).ok).toBe(false);
    expect((await importPostalCodes(file(""))).ok).toBe(false);
    expect(await hasPostalCodes()).toBe(false);
  });
});

describe.skipIf(!hasTestDatabase)("looking a postal code up", () => {
  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    state.userId = user.id;
    state.role = "ADMIN";
  });

  afterAll(() => prisma.$disconnect());

  it("finds a code however it was written", async () => {
    await importPostalCodes(file(GB_LONDON));

    // The file holds "SW1A 1AA"; a person types whichever of these they like.
    for (const typed of ["SW1A 1AA", "sw1a1aa", "sw1a-1aa", " SW1A1AA "]) {
      const result = await lookupPostalCode(formFor(undefined, typed));
      expect(result.data?.places, typed).toMatchObject([{ place: "London", region: "England" }]);
    }
  });

  it("returns every place a code names rather than choosing one", async () => {
    // A postal code really can cover more than one place, and which one an
    // address means is not something this can know.
    await importPostalCodes(
      file(
        "US\t12345\tSchenectady\tNew York\tNY",
        "US\t12345\tGeneral Electric\tNew York\tNY",
      ),
    );

    const places = (await lookupPostalCode(formFor(undefined, "12345"))).data?.places ?? [];
    expect(places).toHaveLength(2);
    expect(places.map((place) => place.place).sort()).toEqual([
      "General Electric",
      "Schenectady",
    ]);
  });

  it("answers nothing for a code that was never imported", async () => {
    await importPostalCodes(file(US_BEVERLY));
    expect((await lookupPostalCode(formFor(undefined, "99999"))).data?.places).toEqual([]);
  });

  it("answers nothing when nothing has been imported", async () => {
    expect(await hasPostalCodes()).toBe(false);
    expect((await lookupPostalCode(formFor(undefined, "90210"))).data?.places).toEqual([]);
  });

  it("is a member's to read, being published reference data", async () => {
    // Importing is administrator-only; reading is not. There is nothing here
    // that one account could learn about another.
    await importPostalCodes(file(US_BEVERLY));
    state.role = "MEMBER";

    const result = await lookupPostalCode(formFor(undefined, "90210"));
    expect(result.ok).toBe(true);
    expect(result.data?.places).toHaveLength(1);
  });
});

function formFor(country?: string, code?: string): FormData {
  const form = new FormData();
  if (country) form.set("country", country);
  if (code) form.set("code", code);
  return form;
}
