"use server";

import { prisma } from "@/server/db/client";
import { getUserContext } from "@/server/user/context";
import { getPrivacyState } from "@/server/privacy/lock";
import { plainDateToDb } from "@/lib/dates";
import { normalizeToPrecision } from "@/lib/date-precision";
import { recomputeContactActivity } from "@/server/services/contact-activity";
import { parseVCard } from "@/lib/import/vcard";
import { parseCsvContacts } from "@/lib/import/csv";
import { findDuplicate, findInternalDuplicates, type Duplicate } from "@/lib/import/dedupe";
import type { ImportedContact } from "@/lib/import/types";
import { fail, ok, type ActionResult } from "./helpers";

export type ImportFormat = "vcard" | "csv";

const FORMATS = new Set<ImportFormat>(["vcard", "csv"]);

/**
 * Caps, so a mistaken file fails with a sentence rather than with whatever the
 * framework does when a body is too large. Generous against any real address
 * book and small enough that parsing cannot become the attack.
 */
const MAX_CHARACTERS = 5_000_000;
const MAX_ROWS = 5_000;

export interface ImportPreviewRow {
  index: number;
  name: string;
  email: string | null;
  detail: string | null;
  problem: string | null;
  /** Already here, as far as we can tell. Never acted on without being shown. */
  duplicate: Duplicate | null;
  /** The same person appears earlier in this same file. */
  repeatedInFile: boolean;
}

export interface ImportPreview {
  format: ImportFormat;
  rows: ImportPreviewRow[];
  importable: number;
  duplicates: number;
  problems: number;
}

/**
 * Whether an import can be judged correctly right now.
 *
 * The same gate the export uses, for a different reason. Nothing is disclosed
 * by importing — but duplicate detection compares against what it can see, and
 * behind a closed lock it cannot see private contacts. Importing then would
 * quietly create a second, visible copy of someone deliberately hidden, which
 * is a worse outcome than being asked to unlock.
 */
async function blockedByLock(): Promise<string | null> {
  const privacy = await getPrivacyState();
  if (!privacy.enabled || privacy.unlocked) return null;
  return "Unlock first. Some of your contacts are hidden while the lock is closed, so an import could not tell whether somebody in this file is already here.";
}

function parse(format: ImportFormat, text: string) {
  return format === "vcard" ? parseVCard(text) : parseCsvContacts(text);
}

function describe(contact: ImportedContact): string | null {
  const bits = [
    contact.employer,
    contact.addresses[0]?.city ?? null,
    contact.birthDate ? "birthday" : null,
  ].filter(Boolean);
  return bits.length > 0 ? bits.join(" · ") : null;
}

/** Everyone already here, for the duplicate check. */
async function existingContacts(ownerId: string) {
  const rows = await prisma.contact.findMany({
    where: { ownerId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      methods: { select: { value: true, type: { select: { slug: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    emails: row.methods.filter((m) => m.type?.slug === "email").map((m) => m.value),
  }));
}

/**
 * Read the file and say what would happen. Writes nothing.
 *
 * Separate from the commit on purpose: an import that decides for you is the
 * one thing worse than no import at all, because merging the wrong two people
 * cannot be undone by hand afterwards.
 */
export async function previewImport(
  format: string,
  text: string,
): Promise<ActionResult<ImportPreview>> {
  if (!FORMATS.has(format as ImportFormat)) return fail("Unknown import format.");
  const chosen = format as ImportFormat;

  const { user } = await getUserContext();
  const blocked = await blockedByLock();
  if (blocked) return fail(blocked);

  if (text.length > MAX_CHARACTERS) {
    return fail("That file is too large to import in one go. Split it and try again.");
  }

  const parsed = parse(chosen, text);
  if (parsed.fileProblem) return fail(parsed.fileProblem);
  if (parsed.rows.length > MAX_ROWS) {
    return fail(`That file holds ${parsed.rows.length} entries; ${MAX_ROWS} is the most at once.`);
  }

  const existing = await existingContacts(user.id);
  const contacts = parsed.rows.map((row) => row.contact).filter((c): c is ImportedContact => c !== null);
  const repeats = findInternalDuplicates(contacts);

  let contactIndex = -1;
  const rows: ImportPreviewRow[] = parsed.rows.map((row) => {
    if (!row.contact) {
      return {
        index: row.index,
        name: "—",
        email: null,
        detail: null,
        problem: row.problem,
        duplicate: null,
        repeatedInFile: false,
      };
    }
    contactIndex += 1;
    return {
      index: row.index,
      name: [row.contact.firstName, row.contact.lastName].filter(Boolean).join(" "),
      email: row.contact.methods.find((m) => m.slug === "email")?.value ?? null,
      detail: describe(row.contact),
      problem: null,
      duplicate: findDuplicate(row.contact, existing),
      repeatedInFile: repeats.has(contactIndex),
    };
  });

  const duplicates = rows.filter((row) => row.duplicate || row.repeatedInFile).length;
  const problems = rows.filter((row) => row.problem).length;
  return ok({
    format: chosen,
    rows,
    importable: rows.length - problems - duplicates,
    duplicates,
    problems,
  });
}

/**
 * Write the rows that were confirmed.
 *
 * The file is parsed again rather than the browser sending back what it was
 * shown: the client chooses *which* rows, never what is in them, so nothing
 * that was not in the file can be written by a crafted request.
 */
export async function commitImport(
  format: string,
  text: string,
  skipIndexes: number[],
): Promise<ActionResult<{ created: number; skipped: number }>> {
  if (!FORMATS.has(format as ImportFormat)) return fail("Unknown import format.");
  const chosen = format as ImportFormat;

  const { user } = await getUserContext();
  const blocked = await blockedByLock();
  if (blocked) return fail(blocked);

  if (text.length > MAX_CHARACTERS) {
    return fail("That file is too large to import in one go. Split it and try again.");
  }

  const parsed = parse(chosen, text);
  if (parsed.fileProblem) return fail(parsed.fileProblem);
  if (parsed.rows.length > MAX_ROWS) {
    return fail(`That file holds ${parsed.rows.length} entries; ${MAX_ROWS} is the most at once.`);
  }

  const skip = new Set(skipIndexes);
  const wanted = parsed.rows.filter((row) => row.contact && !skip.has(row.index));
  if (wanted.length === 0) return fail("Nothing selected to import.");

  // Method types are taxonomy rows, so the slugs the parsers produce have to
  // be resolved to this account's terms. A slug with no term here still keeps
  // its value; an untyped phone number is worth more than no phone number.
  const terms = await prisma.taxonomyTerm.findMany({
    where: { ownerId: user.id, kind: "CONTACT_METHOD_TYPE" },
    select: { id: true, slug: true },
  });
  const termBySlug = new Map(terms.map((term) => [term.slug, term.id]));

  // The timeout is set explicitly, and it is not decoration. An interactive
  // transaction defaults to five seconds, and this writes one row per person
  // inside one — so an address book of any real size, which is the entire
  // reason import exists, would expire partway and roll the whole thing back.
  // `MAX_ROWS` is what makes the bound calculable: five thousand contacts at a
  // few milliseconds each, with room for a slow disk. All-or-nothing is worth
  // holding a transaction this long for; a half-finished import is the one
  // outcome that would leave somebody worse off than not importing.
  const created = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const row of wanted) {
      const contact = row.contact!;
      const made = await tx.contact.create({
        data: {
          ownerId: user.id,
          firstName: contact.firstName.slice(0, 120),
          lastName: contact.lastName?.slice(0, 120) ?? null,
          nickname: contact.nickname?.slice(0, 120) ?? null,
          occupation: contact.occupation?.slice(0, 191) ?? null,
          employer: contact.employer?.slice(0, 191) ?? null,
          summary: contact.summary ?? null,
          city: contact.addresses[0]?.city?.slice(0, 120) ?? null,
          region: contact.addresses[0]?.region?.slice(0, 120) ?? null,
          country: contact.addresses[0]?.country?.slice(0, 120) ?? null,
          // Normalised to its own precision, so "April, year unknown" is
          // stored as the app stores it rather than as whatever day the file
          // happened to carry.
          birthDate: contact.birthDate
            ? plainDateToDb(normalizeToPrecision(contact.birthDate, contact.birthDatePrecision))
            : null,
          birthDatePrecision: contact.birthDatePrecision,
          // Never inherited from a file. Nothing arriving from somewhere else
          // is private until this account says so, and a row that arrived
          // marked private would sit outside the counts the lock depends on.
          isPrivate: false,
          methods: {
            create: contact.methods.slice(0, 20).map((method, order) => ({
              value: method.value.slice(0, 255),
              label: method.label?.slice(0, 96) ?? null,
              sortOrder: order,
              typeId: termBySlug.get(method.slug) ?? null,
            })),
          },
          addresses: {
            create: contact.addresses.slice(0, 5).map((address) => ({
              label: address.label?.slice(0, 96) ?? null,
              line1: address.line1?.slice(0, 191) ?? null,
              line2: address.line2?.slice(0, 191) ?? null,
              city: address.city?.slice(0, 120) ?? null,
              region: address.region?.slice(0, 120) ?? null,
              postalCode: address.postalCode?.slice(0, 32) ?? null,
              country: address.country?.slice(0, 120) ?? null,
            })),
          },
        },
        select: { id: true },
      });
      ids.push(made.id);
    }

    // Never written directly — an imported contact has no interactions, and
    // this is what seeds the activity columns from their creation date.
    await recomputeContactActivity(tx, ids);
    return ids.length;
  }, { timeout: 120_000, maxWait: 10_000 });

  return ok({ created, skipped: parsed.rows.length - created });
}
