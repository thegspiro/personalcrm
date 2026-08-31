import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";
import { recomputeContactActivity } from "@/server/services/contact-activity";
import { resolveLocation } from "@/server/services/locations";
import { zonedStartOfDay, parsePlainDate } from "@/lib/dates";

/**
 * What confirming a quick add actually writes.
 *
 * The action itself needs a request context, so this exercises the same
 * sequence directly against the database — the part worth guarding is that a
 * quick-added interaction goes through the ordinary activity machinery and so
 * cannot corrupt a cadence, and that creating a person and logging against
 * them is one transaction or neither.
 */
const TZ = "America/New_York";

describe.skipIf(!hasTestDatabase)("confirming a quick add", () => {
  let ownerId: string;

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Noon in the account's zone, as the action computes it. */
  function occurredAtFor(key: string): Date {
    const date = parsePlainDate(key)!;
    return new Date(zonedStartOfDay(date, TZ).getTime() + 12 * 3_600_000);
  }

  async function logQuickAdd(opts: {
    contactIds?: string[];
    newNames?: string[];
    dateKey: string;
    title: string;
    location?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const created: string[] = [];
      for (const name of opts.newNames ?? []) {
        const [firstName, ...rest] = name.trim().split(/\s+/);
        const person = await tx.contact.create({
          data: { ownerId, firstName, lastName: rest.join(" ") || null },
          select: { id: true },
        });
        created.push(person.id);
      }
      const contactIds = [...(opts.contactIds ?? []), ...created];
      // `str()` trims the ends and nothing else, so the label reaching the
      // write keeps its interior spacing. Mirrored here so what this exercises
      // is the real value the action would resolve and store.
      const label = opts.location?.trim() || null;
      const place = await resolveLocation(tx, ownerId, label ?? undefined);
      const row = await tx.interaction.create({
        data: {
          ownerId,
          occurredAt: occurredAtFor(opts.dateKey),
          title: opts.title,
          location: label,
          locationId: place?.id ?? null,
          participants: { create: contactIds.map((contactId) => ({ contactId })) },
        },
        select: { id: true },
      });
      await recomputeContactActivity(tx, contactIds);
      return { id: row.id, contactIds };
    });
  }

  it("creates exactly one interaction with the right people", async () => {
    const sarah = await prisma.contact.create({ data: { ownerId, firstName: "Sarah" } });
    const marcus = await prisma.contact.create({ data: { ownerId, firstName: "Marcus" } });

    await logQuickAdd({
      contactIds: [sarah.id, marcus.id],
      dateKey: "2026-03-10",
      title: "Coffee",
    });

    const interactions = await prisma.interaction.findMany({
      where: { ownerId },
      include: { participants: true },
    });
    expect(interactions).toHaveLength(1);
    expect(interactions[0].participants.map((p) => p.contactId).sort()).toEqual(
      [sarah.id, marcus.id].sort(),
    );
  });

  it("lands on the intended day in the account's timezone", async () => {
    const sarah = await prisma.contact.create({ data: { ownerId, firstName: "Sarah" } });
    await logQuickAdd({ contactIds: [sarah.id], dateKey: "2026-03-10", title: "Coffee" });

    const row = await prisma.interaction.findFirstOrThrow({ where: { ownerId } });
    const inZone = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(row.occurredAt);
    // Midday, not midnight — midnight sits close enough to a boundary to land
    // on the wrong date once a timezone gets involved.
    expect(inZone).toBe("2026-03-10");
  });

  it("a backdated quick add does not move last-contact forward", async () => {
    const sarah = await prisma.contact.create({ data: { ownerId, firstName: "Sarah" } });

    const recent = new Date();
    recent.setDate(recent.getDate() - 2);
    await prisma.$transaction(async (tx) => {
      await tx.interaction.create({
        data: {
          ownerId,
          occurredAt: recent,
          title: "Call",
          participants: { create: [{ contactId: sarah.id }] },
        },
      });
      await recomputeContactActivity(tx, [sarah.id]);
    });
    const before = await prisma.contact.findUniqueOrThrow({ where: { id: sarah.id } });

    // Remembering something from months ago must not read as "spoke today".
    await logQuickAdd({ contactIds: [sarah.id], dateKey: "2025-11-02", title: "Old coffee" });

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: sarah.id } });
    expect(after.lastInteractionAt?.getTime()).toBe(before.lastInteractionAt?.getTime());
  });

  it("creates a new person and logs against them together", async () => {
    const result = await logQuickAdd({
      newNames: ["Nadia Fournier"],
      dateKey: "2026-03-10",
      title: "Lunch",
    });

    const person = await prisma.contact.findFirstOrThrow({ where: { ownerId } });
    expect(person.firstName).toBe("Nadia");
    expect(person.lastName).toBe("Fournier");

    const participants = await prisma.interactionParticipant.findMany({
      where: { interactionId: result.id },
    });
    expect(participants.map((p) => p.contactId)).toEqual([person.id]);
    // A new contact starts with a cadence clock, same as one added by hand.
    expect(person.lastInteractionAt).not.toBeNull();
  });

  it("creates neither the person nor the interaction if the write fails", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.contact.create({ data: { ownerId, firstName: "Ghost" } });
        // A participant pointing at nothing — the same shape of failure a bad
        // contact id in the form would cause.
        await tx.interaction.create({
          data: {
            ownerId,
            occurredAt: new Date(),
            participants: { create: [{ contactId: "does-not-exist" }] },
          },
        });
      }),
    ).rejects.toThrow();

    expect(await prisma.contact.count({ where: { ownerId } })).toBe(0);
    expect(await prisma.interaction.count({ where: { ownerId } })).toBe(0);
  });

  it("links the interaction to a place and reuses it however it is typed", async () => {
    const sarah = await prisma.contact.create({ data: { ownerId, firstName: "Sarah" } });

    await logQuickAdd({
      contactIds: [sarah.id],
      dateKey: "2026-03-11",
      title: "Coffee with Sarah",
      location: "Northside Cafe",
    });
    // The same venue typed with different case and spacing is the same place,
    // not a near-duplicate row alongside the first.
    await logQuickAdd({
      contactIds: [sarah.id],
      dateKey: "2026-03-12",
      title: "Coffee with Sarah",
      location: "  northside   cafe ",
    });

    const places = await prisma.location.findMany({ where: { ownerId } });
    expect(places).toHaveLength(1);
    expect(places[0].name).toBe("Northside Cafe");

    const logged = await prisma.interaction.findMany({
      where: { ownerId },
      orderBy: { occurredAt: "asc" },
      select: { location: true, locationId: true },
    });
    expect(logged.map((row) => row.locationId)).toEqual([places[0].id, places[0].id]);
    // The verbatim label is kept per interaction, as everywhere else.
    expect(logged.map((row) => row.location)).toEqual(["Northside Cafe", "northside   cafe"]);
  });

  it("records no place when the line named none", async () => {
    const sarah = await prisma.contact.create({ data: { ownerId, firstName: "Sarah" } });
    await logQuickAdd({ contactIds: [sarah.id], dateKey: "2026-03-11", title: "Coffee" });

    expect(await prisma.location.count({ where: { ownerId } })).toBe(0);
    const [row] = await prisma.interaction.findMany({ where: { ownerId } });
    expect(row.locationId).toBeNull();
  });
});

describe("secret storage", () => {
  const ORIGINAL = process.env.AUTH_SECRET;

  afterAll(() => {
    process.env.AUTH_SECRET = ORIGINAL;
  });

  it("round-trips a key", async () => {
    process.env.AUTH_SECRET = "a-long-enough-development-secret";
    const { encryptSecret, decryptSecret } = await import("@/server/ai/crypto");

    const stored = encryptSecret("sk-ant-example-key");
    expect(stored).not.toContain("sk-ant-example-key");
    expect(decryptSecret(stored)).toBe("sk-ant-example-key");
  });

  it("produces a different ciphertext each time", async () => {
    process.env.AUTH_SECRET = "a-long-enough-development-secret";
    const { encryptSecret } = await import("@/server/ai/crypto");
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("fails closed when the secret changes", async () => {
    process.env.AUTH_SECRET = "a-long-enough-development-secret";
    const { encryptSecret } = await import("@/server/ai/crypto");
    const stored = encryptSecret("sk-ant-example-key");

    // Rotating AUTH_SECRET must make the stored key unreadable rather than
    // throwing — the caller then simply behaves as though no key is set.
    process.env.AUTH_SECRET = "an-entirely-different-secret-value";
    const { decryptSecret } = await import("@/server/ai/crypto");
    expect(decryptSecret(stored)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    process.env.AUTH_SECRET = "a-long-enough-development-secret";
    const { encryptSecret, decryptSecret } = await import("@/server/ai/crypto");
    const stored = encryptSecret("sk-ant-example-key");

    const flipped = `${stored.slice(0, -2)}${stored.slice(-2) === "AA" ? "BB" : "AA"}`;
    expect(decryptSecret(flipped)).toBeNull();
  });

  it("refuses to work without a usable secret", async () => {
    process.env.AUTH_SECRET = "short";
    const { encryptSecret } = await import("@/server/ai/crypto");
    expect(() => encryptSecret("anything")).toThrow(/AUTH_SECRET/);
  });
});
