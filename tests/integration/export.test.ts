import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({ ownerId: "", enabled: true, unlocked: false }));

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: state.ownerId },
    prefs: {},
    timezone: "America/New_York",
  }),
}));

vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({
    pinSet: true,
    enabled: state.enabled,
    unlocked: state.unlocked,
    expiresAt: null,
    retryAfterSeconds: 0,
  }),
}));

const { exportAccount } = await import("@/server/actions/export");

async function addContact(overrides: Record<string, unknown> = {}) {
  return prisma.contact.create({
    data: { ownerId: state.ownerId, firstName: "Dave", lastName: "Kim", ...overrides },
  });
}

describe.skipIf(!hasTestDatabase)("account export", () => {
  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    state.ownerId = user.id;
    state.enabled = true;
    state.unlocked = false;
  });

  it("refuses while the lock hides something, rather than exporting part of it", async () => {
    // The failure this guards: every read in the app filters private rows, so
    // an export built the same way is a file that claims to be everything and
    // silently is not — carried onto a disk somewhere else.
    await addContact();
    await addContact({ firstName: "Hidden", isPrivate: true });

    const result = await exportAccount("json");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unlock first");
  });

  it("refuses behind a closed lock even with nothing marked private", async () => {
    // An earlier version allowed this, reasoning that with no `isPrivate` rows
    // there was nothing to leave out. That modelled the lock as the marker,
    // and it is more: the dating layer is gated by the lock in its own right,
    // so an account with a romantic profile and no marked rows would have
    // exported private notes and date entries in a file. Branching on a count
    // is also itself a disclosure — being refused would answer whether
    // anything private exists.
    await addContact();

    const result = await exportAccount("json");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unlock first");
  });

  it("does not leak dating content behind a closed lock", async () => {
    const contact = await addContact({ isRomantic: true });
    await prisma.romanticProfile.create({
      data: {
        ownerId: state.ownerId,
        contactId: contact.id,
        privateNotes: "SECRET-RETROSPECTIVE",
      },
    });

    const result = await exportAccount("json");
    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it("exports everything once unlocked", async () => {
    await addContact();
    await addContact({ firstName: "Hidden", isPrivate: true });
    state.unlocked = true;

    const result = await exportAccount("json");
    expect(result.ok).toBe(true);
    expect(result.data!.content).toContain("Hidden");
  });

  it("exports when the lock is switched off entirely", async () => {
    await addContact({ firstName: "Hidden", isPrivate: true });
    state.enabled = false;

    const result = await exportAccount("json");
    expect(result.ok).toBe(true);
    expect(result.data!.content).toContain("Hidden");
  });

  it("scopes to the owner", async () => {
    // The invariant every read in this app carries. An export that reached
    // across accounts would be the worst possible place to break it.
    const stranger = await createTestUser();
    await prisma.contact.create({
      data: { ownerId: stranger.id, firstName: "Somebody", lastName: "Else" },
    });
    await addContact();
    state.unlocked = true;

    const result = await exportAccount("json");
    expect(result.data!.content).toContain("Dave");
    expect(result.data!.content).not.toContain("Somebody");
  });

  it("produces each format with a matching name and type", async () => {
    await addContact({ birthDate: new Date(Date.UTC(1990, 3, 15)) });
    state.unlocked = true;

    const json = await exportAccount("json");
    expect(json.data!.filename).toMatch(/^personalcrm-\d{4}-\d{2}-\d{2}\.json$/);
    expect(json.data!.mimeType).toBe("application/json");
    expect(() => JSON.parse(json.data!.content)).not.toThrow();

    const csv = await exportAccount("csv");
    expect(csv.data!.filename).toMatch(/contacts-.*\.csv$/);
    expect(csv.data!.content).toContain("first_name");
    expect(csv.data!.content).toContain("Dave");

    const vcard = await exportAccount("vcard");
    expect(vcard.data!.filename).toMatch(/\.vcf$/);
    expect(vcard.data!.content).toContain("BEGIN:VCARD");
    expect(vcard.data!.content).toContain("BDAY:19900415");

    const ics = await exportAccount("ics");
    expect(ics.data!.filename).toMatch(/\.ics$/);
    expect(ics.data!.content).toContain("BEGIN:VCALENDAR");
    expect(ics.data!.content).toContain("RRULE:FREQ=YEARLY");
  });

  it("writes a year-less birthday without inventing a year", async () => {
    // The database stores a sentinel year for these. Printed into a
    // spreadsheet it reads as real, whatever the precision column beside it
    // says.
    state.unlocked = true;
    await addContact({
      firstName: "Yearless",
      birthDate: new Date(Date.UTC(1904, 3, 15)),
      birthDatePrecision: "MONTH_DAY",
    });

    const csv = await exportAccount("csv");
    expect(csv.data!.content).toContain("--04-15");
    expect(csv.data!.content).not.toContain("1904");
  });

  it("refuses a format it does not produce", async () => {
    const result = await exportAccount("pdf");
    expect(result.ok).toBe(false);
  });

  it("survives a place carrying an OpenStreetMap id", async () => {
    // Location.osmId is a BigInt, and JSON.stringify throws on those rather
    // than skipping them — one optional field on one table would otherwise
    // fail the entire export.
    state.unlocked = true;
    await prisma.location.create({
      data: {
        ownerId: state.ownerId,
        name: "The Anchor",
        normalizedName: "the anchor",
        osmType: "N",
        osmId: BigInt("123456789012"),
      },
    });

    const result = await exportAccount("json");
    expect(result.ok).toBe(true);
    expect(result.data!.content).toContain("123456789012");
  });
});
