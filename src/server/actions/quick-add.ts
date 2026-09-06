"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { transact } from "@/server/db/transaction";
import { type ActionResult, fail, ok, owner, str, strList } from "./helpers";
import { listTerms } from "@/server/taxonomy/queries";
import { listLocationOptions } from "@/server/queries/locations";
import { resolveLocation } from "@/server/services/locations";
import { privacyScope, contactPrivacyWhere } from "@/server/privacy/filter";
import { recomputeContactActivity } from "@/server/services/contact-activity";
import {
  quickParse,
  touchesPrivateContact,
  type ParseContact,
  type ParseLocation,
} from "@/lib/quick-parse";
import { calendarDateInTz, plainDateKey, zonedStartOfDay, parsePlainDate } from "@/lib/dates";

/**
 * Quick add: type one line, confirm what it understood.
 *
 * Two steps on purpose. `interpretQuickAdd` only reads — it never writes, so
 * a misreading costs a correction rather than a bad record — and
 * `confirmQuickAdd` writes exactly what you approved, not what was parsed.
 */

export interface QuickAddPerson {
  id: string;
  name: string;
}

export interface QuickAddAmbiguity {
  matchedText: string;
  candidates: QuickAddPerson[];
}

export interface QuickAddPreview {
  contacts: QuickAddPerson[];
  ambiguous: QuickAddAmbiguity[];
  newNames: string[];
  /** The venue the line named, if any. `id` is null for one not yet recorded. */
  place: { id: string | null; name: string; via: "known" | "preposition" } | null;
  typeId: string | null;
  typeLabel: string | null;
  /** YYYY-MM-DD in the account's timezone. */
  date: string;
  dateText: string | null;
  title: string;
  notes: string | null;
  /** How this was read, so the UI can be honest about it. */
  source: "local" | "assisted";
  /** Why the assisted reading was skipped, when it was. */
  assistNote: string | null;
}

function displayName(c: { firstName: string; lastName: string | null; nickname?: string | null }) {
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.nickname || "Unnamed";
}

/**
 * Read a line without writing anything.
 *
 * The local parser always runs. The optional Claude layer only refines its
 * answer, and only when it is switched on, configured, and the line names
 * nobody private — every other case keeps the local reading rather than
 * surfacing an error.
 */
export async function interpretQuickAdd(text: string): Promise<ActionResult<QuickAddPreview>> {
  const { ownerId, timezone } = await owner();
  const input = (text ?? "").trim();
  if (!input) return fail("Type something first.");

  const scope = await privacyScope();
  const [contacts, types, locations] = await Promise.all([
    // Deliberately not `listContactOptions`: the parser needs to know who is
    // private so it can refuse to send them anywhere, and it needs archived
    // people too — you can log something about someone you archived.
    prisma.contact.findMany({
      where: { ownerId, ...contactPrivacyWhere(scope) },
      select: { id: true, firstName: true, lastName: true, nickname: true, isPrivate: true },
      take: 2000,
    }),
    listTerms(ownerId, "INTERACTION_TYPE"),
    // Privacy-filtered, like the contacts above: which places you have been is
    // itself a disclosure, so a place known only through a hidden interaction
    // is not offered back while the lock is closed.
    listLocationOptions(ownerId),
  ]);

  const parseContacts: ParseContact[] = contacts;
  const parseLocations: ParseLocation[] = locations;
  const now = new Date();
  const local = quickParse(input, {
    contacts: parseContacts,
    types: types.map((t) => ({ id: t.id, slug: t.slug, label: t.label })),
    locations: parseLocations,
    now,
    timeZone: timezone,
  });

  let result = local;
  let source: QuickAddPreview["source"] = "local";
  let assistNote: string | null = null;

  if (touchesPrivateContact(local)) {
    // The PIN is not consent to transmit. A line naming someone you marked
    // private never leaves this machine, whichever way the toggle is set.
    assistNote = "Kept on this machine — that line names someone you've marked private.";
  } else {
    const assisted = await tryAssistedParse(input, ownerId, local, {
      contacts: parseContacts,
      types: types.map((t) => ({ id: t.id, slug: t.slug, label: t.label })),
      locations: parseLocations,
      now,
      timeZone: timezone,
    });
    if (assisted) {
      result = assisted;
      source = "assisted";
    }
  }

  const today = calendarDateInTz(now, timezone);

  return ok({
    contacts: result.contacts.map((m) => ({ id: m.contact.id, name: displayName(m.contact) })),
    ambiguous: result.ambiguous.map((entry) => ({
      matchedText: entry.matchedText,
      candidates: entry.candidates.map((c) => ({ id: c.id, name: displayName(c) })),
    })),
    newNames: result.unknownNames,
    place: result.place
      ? {
          id: result.place.location?.id ?? null,
          // The words typed, not the canonical name. `Interaction.location`
          // keeps the wording used at the time and `locationId` carries the
          // identity — substituting the tidy name here would have quietly
          // rewritten the label the rest of this branch works to preserve.
          // It still resolves to the same place, since the lookup normalizes.
          name: result.place.matchedText,
          via: result.place.via,
        }
      : null,
    typeId: result.type?.id ?? null,
    typeLabel: result.type?.label ?? null,
    date: plainDateKey(result.date ?? today),
    dateText: result.dateText,
    title: result.title,
    notes: result.notes,
    source,
    assistNote,
  });
}

/**
 * The optional refinement, isolated behind a dynamic import.
 *
 * Everything about it can fail — no key, no network, a timeout, a response
 * that does not fit — and every one of those returns null so the local reading
 * stands. Quick add degrading to slightly worse parsing is the only acceptable
 * failure mode.
 */
async function tryAssistedParse(
  input: string,
  ownerId: string,
  fallback: ReturnType<typeof quickParse>,
  context: Parameters<typeof quickParse>[1],
): Promise<ReturnType<typeof quickParse> | null> {
  try {
    const { assistedQuickParse } = await import("@/server/ai/quick-add");
    return await assistedQuickParse(input, ownerId, fallback, context);
  } catch {
    return null;
  }
}

/**
 * Write what you approved.
 *
 * Takes the confirmed values from the form rather than re-parsing, so what is
 * saved is what you saw. Runs through `createInteraction`'s machinery —
 * `recomputeContactActivity` — so a backdated quick add behaves exactly like a
 * backdated log anywhere else and cannot corrupt a cadence.
 */
export async function confirmQuickAdd(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId, timezone } = await owner();

  const title = str(form, "title");
  const dateKey = str(form, "date");
  const parsedDate = dateKey ? parsePlainDate(dateKey) : null;
  if (!parsedDate) return fail("Pick a date.");

  const existingIds = strList(form, "contactIds");
  const newNames = strList(form, "newNames");
  if (existingIds.length === 0 && newNames.length === 0) {
    return fail("Say who this was with.");
  }

  const owned = existingIds.length
    ? await prisma.contact.findMany({
        where: { id: { in: existingIds }, ownerId },
        select: { id: true },
      })
    : [];
  if (owned.length !== existingIds.length) return fail("Some of those people weren't found.");

  const locationText = str(form, "location");
  // `Interaction.location` and `Location.name` are both varchar(191), so an
  // over-long paste would reach the database and throw out of the action
  // instead of coming back as something the form can show.
  if (locationText && locationText.length > 191) {
    return fail("That place name is too long.");
  }
  const typeId = str(form, "typeId");
  if (typeId) {
    const type = await prisma.taxonomyTerm.findFirst({
      where: { id: typeId, ownerId, kind: "INTERACTION_TYPE" },
      select: { id: true },
    });
    if (!type) return fail("Unknown interaction type.");
  }

  // Noon in the account's zone: a quick add carries a day, not a time, and
  // midnight sits close enough to a boundary to land on the wrong date.
  const occurredAt = new Date(zonedStartOfDay(parsedDate, timezone).getTime() + 12 * 3_600_000);

  const interaction = await transact(async (tx) => {
    const created: string[] = [];
    for (const name of newNames) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const [firstName, ...rest] = trimmed.split(/\s+/);
      const person = await tx.contact.create({
        data: { ownerId, firstName, lastName: rest.join(" ") || null },
        select: { id: true },
      });
      created.push(person.id);
    }

    const contactIds = [...owned.map((c) => c.id), ...created];
    // Resolved from the confirmed text, never from a posted id: get-or-create
    // on `(ownerId, normalizedName)` is owner-scoped by construction, so there
    // is no id here for a forged form — or an assisted reading — to smuggle in.
    const place = await resolveLocation(tx, ownerId, locationText ?? undefined);
    const row = await tx.interaction.create({
      data: {
        ownerId,
        typeId: typeId ?? null,
        occurredAt,
        title: title ?? null,
        notes: str(form, "notes") ?? null,
        // The verbatim label stays alongside the canonical place, exactly as
        // every other log path does it.
        location: locationText ?? null,
        locationId: place?.id ?? null,
        participants: { create: contactIds.map((contactId) => ({ contactId })) },
      },
      select: { id: true },
    });

    // Same machinery as every other log: last-contact is derived from the
    // whole history, so backdating cannot make a cadence lie.
    await recomputeContactActivity(tx, contactIds);
    return { id: row.id, contactIds };
  });

  revalidatePath("/");
  revalidatePath("/timeline");
  revalidatePath("/people");
  revalidatePath("/locations");
  for (const contactId of interaction.contactIds) revalidatePath(`/people/${contactId}`);

  return ok({ id: interaction.id });
}

/** People matching a query, for the command palette. */
export async function searchPalette(query: string): Promise<
  ActionResult<{ people: Array<{ id: string; name: string; subtitle: string | null }> }>
> {
  const { ownerId } = await owner();
  const scope = await privacyScope();
  const q = (query ?? "").trim();

  const people = await prisma.contact.findMany({
    where: {
      ownerId,
      isArchived: false,
      // The same filter every other read uses: a private contact must not be
      // reachable through the palette while the lock is on.
      ...contactPrivacyWhere(scope),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q } },
              { lastName: { contains: q } },
              { nickname: { contains: q } },
            ],
          }
        : {}),
    },
    select: { id: true, firstName: true, lastName: true, nickname: true, occupation: true },
    orderBy: [{ lastInteractionAt: { sort: "desc", nulls: "last" } }, { firstName: "asc" }],
    take: 8,
  });

  return ok({
    people: people.map((person) => ({
      id: person.id,
      name: displayName(person),
      subtitle: person.occupation,
    })),
  });
}
