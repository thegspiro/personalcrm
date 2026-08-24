import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";
import {
  deleteCustomFieldValues,
  RENDERED_FIELDS_INPUT,
  saveCustomFieldValues,
} from "@/server/services/custom-field-values";
import { fieldInputName } from "@/lib/custom-fields";
import type { CustomFieldType } from "@prisma/client";

/**
 * Custom field values against a real database.
 *
 * The value-writing path is the part worth testing here: it decides what
 * "absent from the form" means, and getting that wrong silently destroys data
 * rather than failing loudly.
 */
describe.skipIf(!hasTestDatabase)("custom field values", () => {
  let ownerId: string;
  let contactId: string;

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;
    const contact = await prisma.contact.create({ data: { ownerId, firstName: "Ana" } });
    contactId = contact.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function define(
    label: string,
    fieldType: CustomFieldType,
    options?: string[],
  ): Promise<string> {
    const created = await prisma.customFieldDefinition.create({
      data: {
        ownerId,
        entity: "CONTACT",
        key: label.toLowerCase().replace(/\s+/g, "-"),
        label,
        fieldType,
        ...(options ? { options } : {}),
      },
    });
    return created.id;
  }

  /** A form as the renderer builds it: values plus the rendered-ids marker. */
  function formFor(entries: Array<[string, string | string[]]>, rendered: string[]): FormData {
    const form = new FormData();
    form.set(RENDERED_FIELDS_INPUT, rendered.join(","));
    for (const [id, value] of entries) {
      for (const item of Array.isArray(value) ? value : [value]) {
        form.append(fieldInputName(id), item);
      }
    }
    return form;
  }

  async function valueOf(definitionId: string): Promise<unknown> {
    const row = await prisma.customFieldValue.findUnique({
      where: { definitionId_entityId: { definitionId, entityId: contactId } },
    });
    return row?.value ?? null;
  }

  it("stores a value for each type", async () => {
    const text = await define("Coffee order", "TEXT");
    const number = await define("Kids", "NUMBER");
    const date = await define("Anniversary", "DATE");
    const flag = await define("Sends cards", "BOOLEAN");
    const pick = await define("Tea", "SELECT", ["Green", "Black"]);
    const many = await define("Allergies", "MULTISELECT", ["Nuts", "Dairy"]);
    const url = await define("Blog", "URL");

    const form = formFor(
      [
        [text, "Flat white"],
        [number, "2"],
        [date, "2026-03-14"],
        [flag, "true"],
        [pick, "Green"],
        [many, ["Nuts", "Dairy"]],
        [url, "example.com"],
      ],
      [text, number, date, flag, pick, many, url],
    );

    const result = await prisma.$transaction((tx) =>
      saveCustomFieldValues(tx, ownerId, "CONTACT", contactId, form),
    );

    expect(result).toEqual({ ok: true });
    expect(await valueOf(text)).toBe("Flat white");
    expect(await valueOf(number)).toBe(2);
    expect(await valueOf(date)).toBe("2026-03-14");
    expect(await valueOf(flag)).toBe(true);
    expect(await valueOf(pick)).toBe("Green");
    expect(await valueOf(many)).toEqual(["Nuts", "Dairy"]);
    expect(await valueOf(url)).toBe("https://example.com/");
  });

  it("leaves values alone when the form never rendered them", async () => {
    const flag = await define("Sends cards", "BOOLEAN");
    const text = await define("Coffee order", "TEXT");

    await prisma.$transaction((tx) =>
      saveCustomFieldValues(
        tx,
        ownerId,
        "CONTACT",
        contactId,
        formFor([[flag, "true"], [text, "Flat white"]], [flag, text]),
      ),
    );

    // A form with no custom fields at all — the quick-log sheet with its
    // panel never opened, say. Nothing may be touched, and in particular the
    // boolean must not be reset to false.
    const bare = new FormData();
    bare.set("firstName", "Ana");
    await prisma.$transaction((tx) =>
      saveCustomFieldValues(tx, ownerId, "CONTACT", contactId, bare),
    );

    expect(await valueOf(flag)).toBe(true);
    expect(await valueOf(text)).toBe("Flat white");
  });

  it("clears a value when the box is emptied", async () => {
    const text = await define("Coffee order", "TEXT");
    await prisma.$transaction((tx) =>
      saveCustomFieldValues(tx, ownerId, "CONTACT", contactId, formFor([[text, "Flat white"]], [text])),
    );
    expect(await valueOf(text)).toBe("Flat white");

    await prisma.$transaction((tx) =>
      saveCustomFieldValues(tx, ownerId, "CONTACT", contactId, formFor([[text, ""]], [text])),
    );

    // Cleared means the row is gone, not that it holds null — one
    // representation of "not set".
    expect(await prisma.customFieldValue.count({ where: { definitionId: text } })).toBe(0);
  });

  it("unticks a rendered checkbox", async () => {
    const flag = await define("Sends cards", "BOOLEAN");
    await prisma.$transaction((tx) =>
      saveCustomFieldValues(tx, ownerId, "CONTACT", contactId, formFor([[flag, "true"]], [flag])),
    );
    expect(await valueOf(flag)).toBe(true);

    // Rendered but unchecked: absent from the entries, present in the marker.
    await prisma.$transaction((tx) =>
      saveCustomFieldValues(tx, ownerId, "CONTACT", contactId, formFor([], [flag])),
    );
    expect(await valueOf(flag)).toBe(false);
  });

  it("rejects a value of the wrong type without writing anything", async () => {
    const number = await define("Kids", "NUMBER");
    const text = await define("Coffee order", "TEXT");

    const result = await prisma.$transaction((tx) =>
      saveCustomFieldValues(
        tx,
        ownerId,
        "CONTACT",
        contactId,
        formFor([[number, "banana"], [text, "Flat white"]], [number, text]),
      ),
    );

    expect(result.ok).toBe(false);
    // Nothing is written when any field fails — a half-saved form is worse
    // than a rejected one.
    expect(await prisma.customFieldValue.count({ where: { ownerId } })).toBe(0);
  });

  it("ignores a definition belonging to someone else", async () => {
    const other = await createTestUser();
    const theirs = await prisma.customFieldDefinition.create({
      data: {
        ownerId: other.id,
        entity: "CONTACT",
        key: "secret",
        label: "Secret",
        fieldType: "TEXT",
      },
    });

    // Server actions are public endpoints; a form naming another account's
    // definition must not write against it.
    const result = await prisma.$transaction((tx) =>
      saveCustomFieldValues(
        tx,
        ownerId,
        "CONTACT",
        contactId,
        formFor([[theirs.id, "leaked"]], [theirs.id]),
      ),
    );

    expect(result).toEqual({ ok: true });
    expect(await prisma.customFieldValue.count()).toBe(0);
  });

  it("ignores a definition that has been turned off", async () => {
    const retired = await define("Old field", "TEXT");
    await prisma.customFieldDefinition.update({
      where: { id: retired },
      data: { isActive: false },
    });

    await prisma.$transaction((tx) =>
      saveCustomFieldValues(tx, ownerId, "CONTACT", contactId, formFor([[retired, "x"]], [retired])),
    );

    expect(await prisma.customFieldValue.count()).toBe(0);
  });

  it("keeps values through a rename, and drops them on delete", async () => {
    const text = await define("Coffee order", "TEXT");
    await prisma.$transaction((tx) =>
      saveCustomFieldValues(tx, ownerId, "CONTACT", contactId, formFor([[text, "Flat white"]], [text])),
    );

    // Renaming is by id, so the value survives — that is why the label is not
    // the identity.
    await prisma.customFieldDefinition.update({
      where: { id: text },
      data: { label: "Usual drink" },
    });
    expect(await valueOf(text)).toBe("Flat white");

    await prisma.customFieldDefinition.delete({ where: { id: text } });
    expect(await prisma.customFieldValue.count({ where: { ownerId } })).toBe(0);
  });

  it("sweeps values for a deleted record", async () => {
    const text = await define("Coffee order", "TEXT");
    await prisma.$transaction((tx) =>
      saveCustomFieldValues(tx, ownerId, "CONTACT", contactId, formFor([[text, "Flat white"]], [text])),
    );

    // entityId is a plain string, not a foreign key — it points at four
    // different tables — so nothing cascades and the delete paths sweep
    // explicitly. Without this, every deleted record's values would sit in the
    // database forever and turn up in an export.
    await prisma.$transaction(async (tx) => {
      await deleteCustomFieldValues(tx, ownerId, [
        { entity: "CONTACT", entityIds: [contactId] },
      ]);
      await tx.contact.delete({ where: { id: contactId } });
    });

    expect(await prisma.customFieldValue.count()).toBe(0);
  });

  it("sweeps only the entity type it is asked for", async () => {
    const text = await define("Coffee order", "TEXT");
    await prisma.$transaction((tx) =>
      saveCustomFieldValues(tx, ownerId, "CONTACT", contactId, formFor([[text, "Flat white"]], [text])),
    );

    // A contact id and an interaction id could in principle collide; the
    // entity type is what keeps the sweep from taking the wrong rows.
    await prisma.$transaction((tx) =>
      deleteCustomFieldValues(tx, ownerId, [
        { entity: "INTERACTION", entityIds: [contactId] },
      ]),
    );

    expect(await valueOf(text)).toBe("Flat white");
  });

  it("does not sweep another owner's values", async () => {
    const other = await createTestUser();
    const text = await define("Coffee order", "TEXT");
    await prisma.$transaction((tx) =>
      saveCustomFieldValues(tx, ownerId, "CONTACT", contactId, formFor([[text, "Flat white"]], [text])),
    );

    await prisma.$transaction((tx) =>
      deleteCustomFieldValues(tx, other.id, [
        { entity: "CONTACT", entityIds: [contactId] },
      ]),
    );

    expect(await valueOf(text)).toBe("Flat white");
  });
});
