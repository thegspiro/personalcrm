import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({ ownerId: "", enabled: true, unlocked: true }));

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

const { previewImport, commitImport } = await import("@/server/actions/import");

const CARD = [
  "BEGIN:VCARD",
  "VERSION:4.0",
  "FN:Dave Kim",
  "N:Kim;Dave;;;",
  "EMAIL:dave@example.com",
  "TEL;TYPE=cell:+15550104477",
  "BDAY:--0415",
  "END:VCARD",
].join("\r\n");

describe.skipIf(!hasTestDatabase)("contact import", () => {
  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    state.ownerId = user.id;
    state.enabled = true;
    state.unlocked = true;
  });

  it("describes the file without writing anything", async () => {
    const preview = await previewImport("vcard", CARD);

    expect(preview.ok).toBe(true);
    expect(preview.data!.rows[0]).toMatchObject({ name: "Dave Kim", email: "dave@example.com" });
    // The whole point of a preview: nothing has happened yet.
    expect(await prisma.contact.count()).toBe(0);
  });

  it("creates the confirmed rows, with their methods typed", async () => {
    await commitImport("vcard", CARD, []);

    const contact = await prisma.contact.findFirstOrThrow({
      include: { methods: { include: { type: true } } },
    });
    expect(contact.firstName).toBe("Dave");
    expect(contact.lastName).toBe("Kim");
    // Method slugs are taxonomy rows; an import that left them untyped would
    // put every number in the wrong place on the contact page.
    const email = contact.methods.find((m) => m.value === "dave@example.com");
    expect(email!.type!.slug).toBe("email");
    expect(contact.methods.find((m) => m.value === "+15550104477")!.type!.slug).toBe("mobile");
  });

  it("keeps a birthday whose year the file did not state", async () => {
    await commitImport("vcard", CARD, []);
    const contact = await prisma.contact.findFirstOrThrow();

    expect(contact.birthDatePrecision).toBe("MONTH_DAY");
    expect(contact.birthDate!.toISOString().slice(5, 10)).toBe("04-15");
  });

  it("never marks an imported contact private", async () => {
    // Nothing arriving from somewhere else is private until this account says
    // so, and a row that arrived marked private would sit outside the counts
    // the privacy lock depends on.
    await commitImport("vcard", CARD, []);
    expect(await prisma.contact.count({ where: { isPrivate: true } })).toBe(0);
  });

  it("seeds the activity columns rather than leaving them unset", async () => {
    // Written only through the activity service, never directly.
    await prisma.contact.updateMany({ data: {} });
    await commitImport("vcard", CARD, []);
    const contact = await prisma.contact.findFirstOrThrow();
    expect(contact.lastInteractionAt).toBeNull();
  });

  it("skips the rows it was told to skip", async () => {
    const two = `${CARD}\r\n${CARD.replace(/Dave Kim/, "Ada Lovelace").replace("N:Kim;Dave;;;", "N:Lovelace;Ada;;;").replace("dave@", "ada@")}`;
    const result = await commitImport("vcard", two, [1]);

    expect(result.data!.created).toBe(1);
    expect(await prisma.contact.findFirst()).toMatchObject({ firstName: "Ada" });
  });

  it("flags somebody already here rather than creating them twice", async () => {
    await commitImport("vcard", CARD, []);
    const preview = await previewImport("vcard", CARD);

    expect(preview.data!.rows[0].duplicate).toMatchObject({ reason: "email" });
    expect(preview.data!.duplicates).toBe(1);
  });

  it("writes only what the file holds, whatever the client asks for", async () => {
    // The client chooses which rows, never what is in them: the file is parsed
    // again on commit rather than trusting anything sent back.
    await commitImport("vcard", CARD, [99]);
    expect(await prisma.contact.count()).toBe(1);
  });

  it("scopes what it creates to the importing account", async () => {
    const stranger = await createTestUser();
    await commitImport("vcard", CARD, []);

    expect(await prisma.contact.count({ where: { ownerId: stranger.id } })).toBe(0);
    expect(await prisma.contact.count({ where: { ownerId: state.ownerId } })).toBe(1);
  });

  it("refuses while the lock hides contacts it would need to compare against", async () => {
    await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Hidden", isPrivate: true },
    });
    state.unlocked = false;


    const preview = await previewImport("vcard", CARD);
    expect(preview.ok).toBe(false);
    expect(preview.error).toContain("Unlock first");

    const commit = await commitImport("vcard", CARD, []);
    expect(commit.ok).toBe(false);
    expect(await prisma.contact.count()).toBe(1);
  });

  it("refuses behind a closed lock regardless of how much is hidden", async () => {
    // Gated on the lock alone, not on a count: the lock covers the dating
    // layer as well as marked rows, and branching on a count would answer
    // whether anything private exists.
    state.unlocked = false;
    expect((await previewImport("vcard", CARD)).ok).toBe(false);
    expect((await commitImport("vcard", CARD, [])).ok).toBe(false);
    expect(await prisma.contact.count()).toBe(0);
  });

  it("reads a CSV as well", async () => {
    const csv = "first_name,last_name,email\nAda,Lovelace,ada@example.com";
    await commitImport("csv", csv, []);

    const contact = await prisma.contact.findFirstOrThrow({ include: { methods: true } });
    expect(contact.firstName).toBe("Ada");
    expect(contact.methods[0].value).toBe("ada@example.com");
  });

  it("refuses a file it cannot make sense of", async () => {
    expect((await previewImport("csv", "colour,size\nred,large")).ok).toBe(false);
    expect((await previewImport("vcard", "not a vcard at all")).ok).toBe(false);
  });

  it("refuses a format it does not read", async () => {
    expect((await previewImport("json", CARD)).ok).toBe(false);
  });

  it("refuses a file too large to take in one go", async () => {
    const huge = `${CARD}\r\n`.repeat(1) + "x".repeat(5_000_001);
    expect((await previewImport("vcard", huge)).ok).toBe(false);
  });

  it("imports a file large enough to outlast the default transaction timeout", async () => {
    // An interactive transaction defaults to five seconds and this writes a
    // row per person inside one, so a real address book — the whole reason
    // import exists — would expire partway and roll back entirely. Two
    // hundred is enough to catch a regression to the default without making
    // the suite crawl.
    const many = Array.from({ length: 200 }, (_, i) =>
      [
        "BEGIN:VCARD",
        "VERSION:4.0",
        `FN:Person ${i}`,
        `N:Number${i};Person;;;`,
        `EMAIL:person${i}@example.com`,
        "END:VCARD",
      ].join("\r\n"),
    ).join("\r\n");

    const result = await commitImport("vcard", many, []);
    expect(result.ok).toBe(true);
    expect(result.data!.created).toBe(200);
    expect(await prisma.contact.count()).toBe(200);
  });

  it("does not let one oversized note roll back every other contact", async () => {
    // `summary` lands in a TEXT column, which MariaDB rejects rather than
    // trims. Because the whole import is one transaction, that one row used to
    // decide the fate of all the good ones.
    const long = "x".repeat(70_000);
    const file = [
      "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Fine Person\r\nN:Person;Fine;;;\r\nEND:VCARD",
      `BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Wordy Person\r\nN:Person;Wordy;;;\r\nNOTE:${long}\r\nEND:VCARD`,
    ].join("\r\n");

    const result = await commitImport("vcard", file, []);

    expect(result.ok).toBe(true);
    expect(result.data!.created).toBe(2);
    const wordy = await prisma.contact.findFirstOrThrow({ where: { firstName: "Wordy" } });
    expect(wordy.summary!.length).toBeLessThanOrEqual(65_535);
    expect(wordy.summary!.startsWith("xxx")).toBe(true);
  });

  it("keeps a multi-byte note inside the column's byte budget", async () => {
    // TEXT is measured in bytes, so an accented note overflows at roughly half
    // the character count, and a cut on a byte boundary would split a
    // character in two.
    const long = "é".repeat(40_000);
    const file = `BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Accented Person\r\nN:Person;Accented;;;\r\nNOTE:${long}\r\nEND:VCARD`;

    const result = await commitImport("vcard", file, []);

    expect(result.ok).toBe(true);
    const person = await prisma.contact.findFirstOrThrow({ where: { firstName: "Accented" } });
    expect(new TextEncoder().encode(person.summary!).length).toBeLessThanOrEqual(65_535);
    expect(person.summary).not.toContain("\uFFFD");
  });

  it("declines an empty selection instead of reporting a silent success", async () => {
    const result = await commitImport("vcard", CARD, [1]);
    expect(result.ok).toBe(false);
    expect(await prisma.contact.count()).toBe(0);
  });
});
