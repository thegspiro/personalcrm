import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

/**
 * Phone numbers, email addresses, handles and postal addresses.
 *
 * Both tables predate any way to write to them, so these run the real actions
 * rather than an imitation — the parts worth guarding are the ones an
 * imitation leaves out. Neither model carries `ownerId` or `isPrivate`: they
 * exist only beneath a contact, so ownership and the lock are enforced on the
 * contact, and that indirection is the thing most likely to be got wrong.
 */

const state = vi.hoisted(() => ({ ownerId: "", enabled: false, unlocked: true }));

const TZ = "America/New_York";

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({ user: { id: state.ownerId }, prefs: {}, timezone: TZ }),
}));

vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({
    pinSet: state.enabled,
    enabled: state.enabled,
    unlocked: state.unlocked,
    retryAfterSeconds: 0,
  }),
  recordProtectedReadActivity: async () => ({ ok: true, expiresAt: null }),
  requireUnlocked: async () =>
    state.enabled && !state.unlocked ? { ok: false, error: "Unlock to continue." } : { ok: true },
}));

const {
  createAddress,
  createContactMethod,
  deleteAddress,
  deleteContactMethod,
  moveContactMethod,
  setPrimaryContactMethod,
  updateAddress,
  updateContactMethod,
} = await import("@/server/actions/details");
const { listContacts } = await import("@/server/queries/contacts");

function form(values: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

describe.skipIf(!hasTestDatabase)("contact methods and addresses", () => {
  let ownerId: string;
  let strangerId: string;
  let danaId: string;
  let privateId: string;
  let mobileTypeId: string;
  let emailTypeId: string;

  beforeEach(async () => {
    await reset();
    const owner = await createTestUser();
    const stranger = await createTestUser();
    ownerId = owner.id;
    strangerId = stranger.id;
    state.ownerId = ownerId;
    state.enabled = false;
    state.unlocked = true;

    const [dana, hidden] = await Promise.all([
      prisma.contact.create({ data: { ownerId, firstName: "Dana", lastName: "Whitfield" } }),
      prisma.contact.create({ data: { ownerId, firstName: "Robin", isPrivate: true } }),
    ]);
    danaId = dana.id;
    privateId = hidden.id;

    const types = await prisma.taxonomyTerm.findMany({
      where: { ownerId, kind: "CONTACT_METHOD_TYPE", slug: { in: ["mobile", "email"] } },
      select: { id: true, slug: true },
    });
    mobileTypeId = types.find((term) => term.slug === "mobile")!.id;
    emailTypeId = types.find((term) => term.slug === "email")!.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores a number exactly as it was typed", async () => {
    // Normalising to E.164 would guess a country nobody supplied.
    const result = await createContactMethod(
      form({ contactId: danaId, typeId: mobileTypeId, value: "  +1 (555) 010-4477  ", label: "Work" }),
    );
    expect(result.ok).toBe(true);

    const stored = await prisma.contactMethod.findFirstOrThrow({ where: { contactId: danaId } });
    expect(stored.value).toBe("+1 (555) 010-4477");
    expect(stored.label).toBe("Work");
    expect(stored.typeId).toBe(mobileTypeId);
    // The only method there is, is the one to try first.
    expect(stored.isPrimary).toBe(true);
  });

  it("marks the first method primary and leaves later ones alone", async () => {
    await createContactMethod(form({ contactId: danaId, typeId: mobileTypeId, value: "first" }));
    await createContactMethod(form({ contactId: danaId, typeId: emailTypeId, value: "second" }));

    const rows = await prisma.contactMethod.findMany({
      where: { contactId: danaId },
      orderBy: { sortOrder: "asc" },
    });
    expect(rows.map((row) => row.isPrimary)).toEqual([true, false]);

    // Deleting the primary does not promote anything — nothing should guess
    // which of the remaining rows you would rather be called on.
    await deleteContactMethod(rows[0].id);
    expect(await prisma.contactMethod.count({ where: { contactId: danaId, isPrimary: true } })).toBe(0);
  });

  it("refuses an empty value and a contact that is not yours", async () => {
    expect((await createContactMethod(form({ contactId: danaId, value: "   " }))).ok).toBe(false);

    const theirs = await prisma.contact.create({
      data: { ownerId: strangerId, firstName: "Someone" },
    });
    const result = await createContactMethod(form({ contactId: theirs.id, value: "555-0134" }));
    expect(result).toMatchObject({ ok: false, error: "Contact not found." });
    expect(await prisma.contactMethod.count({ where: { contactId: theirs.id } })).toBe(0);
  });

  it("refuses a type belonging to someone else, or the right id under the wrong kind", async () => {
    const theirType = await prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId: strangerId, kind: "CONTACT_METHOD_TYPE" },
    });
    expect(
      (await createContactMethod(form({ contactId: danaId, typeId: theirType.id, value: "x@y.zz" })))
        .ok,
    ).toBe(false);

    const wrongKind = await prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId, kind: "FACT_CATEGORY" },
    });
    expect(
      (await createContactMethod(form({ contactId: danaId, typeId: wrongKind.id, value: "x@y.zz" })))
        .ok,
    ).toBe(false);
  });

  it("appends each new method after the last, rather than colliding on zero", async () => {
    for (const value of ["first", "second", "third"]) {
      await createContactMethod(form({ contactId: danaId, typeId: mobileTypeId, value }));
    }
    const rows = await prisma.contactMethod.findMany({
      where: { contactId: danaId },
      orderBy: { sortOrder: "asc" },
    });
    expect(rows.map((row) => row.value)).toEqual(["first", "second", "third"]);
    expect(rows.map((row) => row.sortOrder)).toEqual([0, 1, 2]);
  });

  it("keeps exactly one primary however many times it is set", async () => {
    const ids: string[] = [];
    for (const value of ["one", "two", "three"]) {
      const created = await createContactMethod(
        form({ contactId: danaId, typeId: mobileTypeId, value }),
      );
      ids.push((created as { data: { id: string } }).data.id);
    }

    await setPrimaryContactMethod(ids[0]);
    await setPrimaryContactMethod(ids[2]);
    // Twice on the same row: the demote-then-promote pair must be idempotent.
    await setPrimaryContactMethod(ids[2]);

    const primary = await prisma.contactMethod.findMany({
      where: { contactId: danaId, isPrimary: true },
    });
    expect(primary).toHaveLength(1);
    expect(primary[0].id).toBe(ids[2]);
  });

  it("does not let one contact's primary demote another contact's", async () => {
    const other = await prisma.contact.create({ data: { ownerId, firstName: "Sam" } });
    const mine = await createContactMethod(
      form({ contactId: danaId, typeId: mobileTypeId, value: "mine" }),
    );
    const theirs = await createContactMethod(
      form({ contactId: other.id, typeId: mobileTypeId, value: "theirs" }),
    );
    await setPrimaryContactMethod((mine as { data: { id: string } }).data.id);
    await setPrimaryContactMethod((theirs as { data: { id: string } }).data.id);

    expect(await prisma.contactMethod.count({ where: { isPrimary: true } })).toBe(2);
  });

  it("swaps with its neighbour, and does nothing at the ends", async () => {
    const ids: string[] = [];
    for (const value of ["a", "b", "c"]) {
      const created = await createContactMethod(
        form({ contactId: danaId, typeId: mobileTypeId, value }),
      );
      ids.push((created as { data: { id: string } }).data.id);
    }

    expect((await moveContactMethod(ids[2], "up")).ok).toBe(true);
    let rows = await prisma.contactMethod.findMany({
      where: { contactId: danaId },
      orderBy: { sortOrder: "asc" },
    });
    expect(rows.map((row) => row.value)).toEqual(["a", "c", "b"]);

    // Already at the top — not an error, just nothing to do.
    expect((await moveContactMethod(ids[0], "up")).ok).toBe(true);
    rows = await prisma.contactMethod.findMany({
      where: { contactId: danaId },
      orderBy: { sortOrder: "asc" },
    });
    expect(rows.map((row) => row.value)).toEqual(["a", "c", "b"]);
  });

  it("edits and deletes only rows reachable through a contact you own", async () => {
    const theirContact = await prisma.contact.create({
      data: { ownerId: strangerId, firstName: "Someone" },
    });
    const theirMethod = await prisma.contactMethod.create({
      data: { contactId: theirContact.id, value: "555-0199" },
    });

    expect(
      (await updateContactMethod(form({ id: theirMethod.id, value: "hijacked" }))).ok,
    ).toBe(false);
    expect((await deleteContactMethod(theirMethod.id)).ok).toBe(false);
    expect((await setPrimaryContactMethod(theirMethod.id)).ok).toBe(false);
    expect((await moveContactMethod(theirMethod.id, "up")).ok).toBe(false);

    const untouched = await prisma.contactMethod.findFirstOrThrow({ where: { id: theirMethod.id } });
    expect(untouched.value).toBe("555-0199");
  });

  it("hides a private contact's number behind the lock, by id as well as by list", async () => {
    const created = await createContactMethod(
      form({ contactId: privateId, typeId: mobileTypeId, value: "555-0111" }),
    );
    const methodId = (created as { data: { id: string } }).data.id;

    // An id remembered from an unlocked session is not a way back in.
    state.enabled = true;
    state.unlocked = false;

    expect((await updateContactMethod(form({ id: methodId, value: "changed" }))).ok).toBe(false);
    expect((await deleteContactMethod(methodId)).ok).toBe(false);
    expect((await setPrimaryContactMethod(methodId)).ok).toBe(false);
    expect((await moveContactMethod(methodId, "down")).ok).toBe(false);

    const stored = await prisma.contactMethod.findFirstOrThrow({ where: { id: methodId } });
    expect(stored.value).toBe("555-0111");

    state.unlocked = true;
    expect((await updateContactMethod(form({ id: methodId, value: "changed" }))).ok).toBe(true);
  });

  it("refuses to attach anything to a private contact while the lock is closed", async () => {
    // Creating asked only "is this contact mine", where every update and delete
    // asked "and may I see it". So an id kept from an unlocked session went on
    // attaching numbers and addresses to someone the lock was hiding.
    state.enabled = true;
    state.unlocked = false;

    const method = await createContactMethod(
      form({ contactId: privateId, typeId: mobileTypeId, value: "555-0111" }),
    );
    expect(method).toMatchObject({ ok: false, error: "Contact not found." });

    const address = await createAddress(form({ contactId: privateId, city: "Somewhere" }));
    expect(address).toMatchObject({ ok: false, error: "Contact not found." });

    expect(await prisma.contactMethod.count({ where: { contactId: privateId } })).toBe(0);
    expect(await prisma.address.count({ where: { contactId: privateId } })).toBe(0);

    // A visible contact is unaffected, and unlocking restores the private one.
    expect(
      (await createContactMethod(form({ contactId: danaId, typeId: mobileTypeId, value: "555-0134" }))).ok,
    ).toBe(true);

    state.unlocked = true;
    expect(
      (await createContactMethod(form({ contactId: privateId, typeId: mobileTypeId, value: "555-0111" }))).ok,
    ).toBe(true);
  });

  it("does not surface a private contact through a search for their number", async () => {
    await createContactMethod(
      form({ contactId: privateId, typeId: mobileTypeId, value: "555-0111" }),
    );
    await createContactMethod(
      form({ contactId: danaId, typeId: emailTypeId, value: "dana@example.com" }),
    );

    state.enabled = true;
    state.unlocked = false;
    const locked = await listContacts(ownerId, { search: "555-0111" });
    // The count has to move with the rows: a total that shifts on unlock is
    // itself a disclosure.
    expect(locked.items).toHaveLength(0);
    expect(locked.total).toBe(0);

    state.unlocked = true;
    const unlocked = await listContacts(ownerId, { search: "555-0111" });
    expect(unlocked.items.map((row) => row.firstName)).toEqual(["Robin"]);

    const byEmail = await listContacts(ownerId, { search: "dana@example" });
    expect(byEmail.items.map((row) => row.firstName)).toEqual(["Dana"]);
  });

  it("returns a field error for an over-long value rather than throwing", async () => {
    // Unbounded, these reach MariaDB and come back as an exception out of the
    // action instead of something the form can render.
    const long = await createContactMethod(
      form({ contactId: danaId, typeId: mobileTypeId, value: "x".repeat(256) }),
    );
    expect(long.ok).toBe(false);
    expect(long.fieldErrors).toMatchObject({ value: expect.any(String) });

    const longLabel = await createContactMethod(
      form({ contactId: danaId, typeId: mobileTypeId, value: "555-0134", label: "y".repeat(97) }),
    );
    expect(longLabel.ok).toBe(false);
    expect(await prisma.contactMethod.count()).toBe(0);

    // At the limit is fine.
    expect(
      (await createContactMethod(form({ contactId: danaId, typeId: mobileTypeId, value: "x".repeat(255) }))).ok,
    ).toBe(true);
  });

  it("bounds every address column it writes", async () => {
    for (const [field, length] of [
      ["label", 96],
      ["line1", 191],
      ["city", 120],
      ["postalCode", 32],
      ["country", 120],
    ] as const) {
      const result = await createAddress(
        form({ contactId: danaId, line1: "14 Ashfield Road", [field]: "z".repeat(length + 1) }),
      );
      expect(result.ok, `${field} should be bounded`).toBe(false);
    }
    expect(await prisma.address.count()).toBe(0);
  });

  it("puts a promoted method first, so the arrows match what is shown", async () => {
    const ids: string[] = [];
    for (const value of ["a", "b", "c"]) {
      const created = await createContactMethod(
        form({ contactId: danaId, typeId: mobileTypeId, value }),
      );
      ids.push((created as { data: { id: string } }).data.id);
    }

    // The list renders primary-first; without moving the row, "c" would show
    // at the top while its sortOrder stayed last, and its down arrow would
    // find no greater sortOrder and appear to do nothing.
    await setPrimaryContactMethod(ids[2]);

    const rows = await prisma.contactMethod.findMany({
      where: { contactId: danaId },
      orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
    });
    expect(rows.map((row) => row.value)).toEqual(["c", "a", "b"]);
    // Rendering order and sortOrder order are now the same list.
    expect(rows.map((row) => row.sortOrder)).toEqual([0, 1, 2]);

    // The primary row does not move: the list pins it first, so swapping its
    // sortOrder would leave it exactly where it was and read as a dead arrow.
    // The form does not offer the arrows on it, and the action agrees.
    expect((await moveContactMethod(ids[2], "down")).ok).toBe(true);
    const after = await prisma.contactMethod.findMany({
      where: { contactId: danaId },
      orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
    });
    expect(after.map((row) => row.value)).toEqual(["c", "a", "b"]);

    // The others still reorder among themselves, below the pinned one.
    expect((await moveContactMethod(ids[1], "up")).ok).toBe(true);
    const swapped = await prisma.contactMethod.findMany({
      where: { contactId: danaId },
      orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
    });
    expect(swapped.map((row) => row.value)).toEqual(["c", "b", "a"]);
  });

  it("refuses an address with nothing in it, so no row is only a delete button", async () => {
    const result = await createAddress(form({ contactId: danaId, label: "Home", notes: "buzzer" }));
    expect(result.ok).toBe(false);
    expect(await prisma.address.count()).toBe(0);

    expect((await createAddress(form({ contactId: danaId, city: "Lagos" }))).ok).toBe(true);
  });

  it("keeps an address correction whole rather than clearing what the form omits", async () => {
    const created = await createAddress(
      form({ contactId: danaId, label: "Home", line1: "14 Ashfield Road", city: "Leeds" }),
    );
    const id = (created as { data: { id: string } }).data.id;

    await updateAddress(form({ id, label: "Home", line1: "14 Ashfield Road", city: "Bristol" }));
    const stored = await prisma.address.findFirstOrThrow({ where: { id } });
    expect(stored.city).toBe("Bristol");
    expect(stored.line1).toBe("14 Ashfield Road");

    // A field genuinely left blank still clears — the action writes what the
    // whole form says, which is why the add and edit forms carry the same fields.
    await updateAddress(form({ id, line1: "14 Ashfield Road" }));
    expect((await prisma.address.findFirstOrThrow({ where: { id } })).city).toBeNull();
  });

  it("scopes addresses by owner and by the lock, the same as methods", async () => {
    const theirContact = await prisma.contact.create({
      data: { ownerId: strangerId, firstName: "Someone" },
    });
    const theirs = await prisma.address.create({
      data: { contactId: theirContact.id, city: "Elsewhere" },
    });
    expect((await updateAddress(form({ id: theirs.id, city: "Hijacked" }))).ok).toBe(false);
    expect((await deleteAddress(theirs.id)).ok).toBe(false);

    const hidden = await createAddress(form({ contactId: privateId, city: "Somewhere" }));
    const hiddenId = (hidden as { data: { id: string } }).data.id;
    state.enabled = true;
    state.unlocked = false;
    expect((await updateAddress(form({ id: hiddenId, city: "Changed" }))).ok).toBe(false);
    expect((await deleteAddress(hiddenId)).ok).toBe(false);
  });

  it("takes both with the contact, since neither cascades on its own", async () => {
    await createContactMethod(form({ contactId: danaId, typeId: mobileTypeId, value: "555-0134" }));
    await createAddress(form({ contactId: danaId, city: "Leeds" }));

    await prisma.contact.delete({ where: { id: danaId } });

    expect(await prisma.contactMethod.count()).toBe(0);
    expect(await prisma.address.count()).toBe(0);
  });
});
