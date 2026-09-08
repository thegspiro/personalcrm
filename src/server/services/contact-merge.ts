import "server-only";
import type { Prisma } from "@prisma/client";
import { recomputeContactActivity } from "./contact-activity";
import { orderedPair } from "@/lib/duplicates";

type Tx = Prisma.TransactionClient;

/**
 * Folding one contact into another, permanently.
 *
 * There is no undo in this app and no soft delete, so the whole design of this
 * file is "move everything, lose nothing, and refuse rather than guess". The
 * losing record is deleted at the end; every row that pointed at it points at
 * the survivor first.
 *
 * Twenty-three tables carry a contact-shaped key, plus `CustomFieldValue`,
 * whose `entityId` is deliberately not a foreign key. They are handled here in
 * one explicit list rather than by anything clever, because the failure mode of
 * clever is silent: a relation nobody remembered is a relation whose rows go
 * over the cascade with the losing contact, and nobody finds out until they go
 * looking for a birthday that is not there any more.
 *
 * Seven of those tables carry a unique constraint that a straight repoint would
 * violate — the same tag on both, the same interaction naming both, both in one
 * household. Each is moved only where the survivor does not already hold the
 * equivalent row, and the rest are dropped as the duplicates they now are.
 * Two more can become self-referential: a relationship *between* the two, and a
 * dismissal *of* the two, are meaningless afterwards and go.
 */

export type MergeRefusal =
  | "not-found"
  | "same-contact"
  | "both-romantic";

export interface MergeOutcome {
  ok: boolean;
  refusal?: MergeRefusal;
  /** The avatar file the loser held, for the caller to unlink after commit. */
  discardedAvatarPath?: string | null;
}

/**
 * The columns the caller may choose between.
 *
 * Constrained to real columns by `Prisma.ContactUncheckedUpdateInput` rather
 * than written out as free-form strings. The first version of this was a plain
 * union of names and two of them — `jobTitle`, `company` — were not columns at
 * all; the values cast straight through to `update` and only a test caught it.
 * Anything not on this list, `id`, `ownerId`, `isPrivate` and the derived
 * activity columns included, is not the caller's to set.
 */
export type MergeableField = Extract<
  keyof Prisma.ContactUncheckedUpdateInput,
  | "firstName"
  | "lastName"
  | "nickname"
  | "pronouns"
  | "avatarPath"
  | "categoryId"
  | "birthDate"
  | "birthDatePrecision"
  | "howWeMet"
  | "whereWeMet"
  | "metOn"
  | "metOnPrecision"
  | "meetingSourceId"
  | "occupation"
  | "employer"
  | "city"
  | "region"
  | "country"
  | "timezone"
  | "summary"
  | "isFavorite"
  | "cadenceDays"
>;

export type MergeFields = Pick<Prisma.ContactUncheckedUpdateInput, MergeableField>;

export interface MergeInput {
  winnerId: string;
  loserId: string;
  /** Chosen values, already validated by the caller against both records. */
  fields: MergeFields;
}

/**
 * Move rows whose target table has no constraint to collide on.
 *
 * A plain repoint: every row the loser owned becomes the survivor's.
 */
const SIMPLE_MOVES = [
  "contactMethod",
  "address",
  "fact",
  "importantDate",
  "lifeEvent",
  "happening",
  "gift",
  "debt",
  "dietaryNeed",
  "dateEntry",
  "flag",
  "idea",
  "task",
  "plan",
] as const;

export async function mergeContacts(
  tx: Tx,
  ownerId: string,
  input: MergeInput,
  where: Prisma.ContactWhereInput,
): Promise<MergeOutcome> {
  const { winnerId, loserId } = input;
  if (winnerId === loserId) return { ok: false, refusal: "same-contact" };

  // Both must be this owner's *and* visible under the caller's privacy scope.
  // Merging into something you cannot see would let a closed lock be used to
  // fold a private person into a public one without ever showing you either.
  const pair = await tx.contact.findMany({
    where: { AND: [{ ownerId, id: { in: [winnerId, loserId] } }, where] },
    select: { id: true, isPrivate: true, avatarPath: true },
  });
  if (pair.length !== 2) return { ok: false, refusal: "not-found" };

  const loser = pair.find((row) => row.id === loserId)!;
  const winner = pair.find((row) => row.id === winnerId)!;

  // A romantic profile is a whole record, not a field, and there is exactly one
  // per contact. Silently dropping one would be the largest thing this could
  // destroy without saying so, so it refuses and asks for the choice to be made
  // deliberately first.
  const profiles = await tx.romanticProfile.findMany({
    where: { ownerId, contactId: { in: [winnerId, loserId] } },
    select: { contactId: true },
  });
  if (profiles.length === 2) return { ok: false, refusal: "both-romantic" };

  await moveSimple(tx, winnerId, loserId);
  await moveTags(tx, winnerId, loserId);
  await moveRelationships(tx, ownerId, winnerId, loserId);
  await moveInteractionLinks(tx, winnerId, loserId);
  await moveLifeEventParticipants(tx, winnerId, loserId);
  await moveHouseholdMemberships(tx, winnerId, loserId);
  await moveAssociates(tx, winnerId, loserId);
  await moveRomanticProfile(tx, ownerId, winnerId, loserId);
  await moveDismissals(tx, ownerId, winnerId, loserId);
  await moveCustomFieldValues(tx, ownerId, winnerId, loserId);

  await tx.contact.update({
    where: { id: winnerId },
    data: {
      ...input.fields,
      // Never a choice. Folding a private person into a public record would
      // publish everything they carried; the safe direction is the only one.
      isPrivate: winner.isPrivate || loser.isPrivate,
    },
  });

  await tx.contact.delete({ where: { id: loserId } });

  // Invariant 1: never assigned, always recomputed from the full history —
  // which is now the history of both.
  await recomputeContactActivity(tx, [winnerId]);

  return {
    ok: true,
    // Only when the survivor is not keeping it: the caller may have chosen the
    // loser's picture, in which case the file is still in use.
    discardedAvatarPath:
      loser.avatarPath && loser.avatarPath !== input.fields.avatarPath
        ? loser.avatarPath
        : null,
  };
}

async function moveSimple(tx: Tx, winnerId: string, loserId: string): Promise<void> {
  for (const model of SIMPLE_MOVES) {
    // Each delegate has the same `updateMany` shape; the union is too wide for
    // TypeScript to see that, and enumerating fourteen identical calls by hand
    // is how one of them ends up pointing at the wrong column.
    const delegate = tx[model] as unknown as {
      updateMany(args: {
        where: { contactId: string };
        data: { contactId: string };
      }): Promise<unknown>;
    };
    await delegate.updateMany({ where: { contactId: loserId }, data: { contactId: winnerId } });
  }
}

/** `@@id([contactId, tagId])` — a tag on both sides collides. */
async function moveTags(tx: Tx, winnerId: string, loserId: string): Promise<void> {
  const held = await tx.contactTag.findMany({
    where: { contactId: winnerId },
    select: { tagId: true },
  });
  const already = held.map((row) => row.tagId);

  await tx.contactTag.deleteMany({ where: { contactId: loserId, tagId: { in: already } } });
  await tx.contactTag.updateMany({
    where: { contactId: loserId },
    data: { contactId: winnerId },
  });
}

/**
 * `@@unique([fromContactId, toContactId, typeId])`, and the self-reference.
 *
 * "Sam is Robin's brother" survives the merge. "Sam is Sam's brother" cannot,
 * and is what a relationship *between* the two records becomes.
 */
async function moveRelationships(
  tx: Tx,
  ownerId: string,
  winnerId: string,
  loserId: string,
): Promise<void> {
  await tx.relationship.deleteMany({
    where: {
      ownerId,
      OR: [
        { fromContactId: winnerId, toContactId: loserId },
        { fromContactId: loserId, toContactId: winnerId },
      ],
    },
  });

  const existing = await tx.relationship.findMany({
    where: { ownerId, OR: [{ fromContactId: winnerId }, { toContactId: winnerId }] },
    select: { fromContactId: true, toContactId: true, typeId: true },
  });
  const held = new Set(
    existing.map((row) => `${row.fromContactId}|${row.toContactId}|${row.typeId}`),
  );

  for (const side of ["fromContactId", "toContactId"] as const) {
    const rows = await tx.relationship.findMany({
      where: { ownerId, [side]: loserId },
      select: { id: true, fromContactId: true, toContactId: true, typeId: true },
    });

    for (const row of rows) {
      const from = side === "fromContactId" ? winnerId : row.fromContactId;
      const to = side === "toContactId" ? winnerId : row.toContactId;
      const key = `${from}|${to}|${row.typeId}`;
      if (held.has(key)) {
        await tx.relationship.delete({ where: { id: row.id } });
        continue;
      }
      held.add(key);
      await tx.relationship.update({ where: { id: row.id }, data: { [side]: winnerId } });
    }
  }
}

/**
 * `@@id([interactionId, contactId])` on both participants and mentions.
 *
 * An interaction naming both people collapses to one row rather than failing.
 */
async function moveInteractionLinks(tx: Tx, winnerId: string, loserId: string): Promise<void> {
  for (const model of ["interactionParticipant", "interactionMention"] as const) {
    const delegate = tx[model] as unknown as {
      findMany(args: {
        where: { contactId: string };
        select: { interactionId: true };
      }): Promise<Array<{ interactionId: string }>>;
      deleteMany(args: {
        where: { contactId: string; interactionId: { in: string[] } };
      }): Promise<unknown>;
      updateMany(args: {
        where: { contactId: string };
        data: { contactId: string };
      }): Promise<unknown>;
    };

    const held = await delegate.findMany({
      where: { contactId: winnerId },
      select: { interactionId: true },
    });
    await delegate.deleteMany({
      where: { contactId: loserId, interactionId: { in: held.map((r) => r.interactionId) } },
    });
    await delegate.updateMany({ where: { contactId: loserId }, data: { contactId: winnerId } });
  }
}

/** `@@id([lifeEventId, contactId])` — an event naming both collapses to one. */
async function moveLifeEventParticipants(
  tx: Tx,
  winnerId: string,
  loserId: string,
): Promise<void> {
  const held = await tx.lifeEventParticipant.findMany({
    where: { contactId: winnerId },
    select: { lifeEventId: true },
  });
  await tx.lifeEventParticipant.deleteMany({
    where: { contactId: loserId, lifeEventId: { in: held.map((row) => row.lifeEventId) } },
  });
  await tx.lifeEventParticipant.updateMany({
    where: { contactId: loserId },
    data: { contactId: winnerId },
  });
}

/** `@@id([householdId, contactId])` — both in one household is one membership. */
async function moveHouseholdMemberships(
  tx: Tx,
  winnerId: string,
  loserId: string,
): Promise<void> {
  const held = await tx.householdMember.findMany({
    where: { contactId: winnerId },
    select: { householdId: true },
  });
  await tx.householdMember.deleteMany({
    where: { contactId: loserId, householdId: { in: held.map((row) => row.householdId) } },
  });
  await tx.householdMember.updateMany({
    where: { contactId: loserId },
    data: { contactId: winnerId },
  });
}

/**
 * Associates hang off a contact, and may also *point at* one.
 *
 * The second is the one easily missed: an associate promoted into the losing
 * record still names it, and leaving that would set the link to null on delete
 * — quietly turning a tracked person back into a note.
 */
async function moveAssociates(tx: Tx, winnerId: string, loserId: string): Promise<void> {
  await tx.associate.updateMany({
    where: { contactId: loserId },
    data: { contactId: winnerId },
  });
  await tx.associate.updateMany({
    where: { promotedContactId: loserId },
    data: { promotedContactId: winnerId },
  });
  // An associate of the survivor that was promoted into the survivor is a
  // person listed as their own acquaintance.
  await tx.associate.deleteMany({
    where: { contactId: winnerId, promotedContactId: winnerId },
  });
}

/** `@@unique([ownerId, contactId])`. Only reached when at most one side has one. */
async function moveRomanticProfile(
  tx: Tx,
  ownerId: string,
  winnerId: string,
  loserId: string,
): Promise<void> {
  await tx.romanticProfile.updateMany({
    where: { ownerId, contactId: loserId },
    data: { contactId: winnerId },
  });
}

/** Pair rows: repoint, drop the pair that has become one person, dedupe. */
async function moveDismissals(
  tx: Tx,
  ownerId: string,
  winnerId: string,
  loserId: string,
): Promise<void> {
  for (const model of ["familySuggestionDismissal", "duplicateDismissal"] as const) {
    const delegate = tx[model] as unknown as {
      findMany(args: {
        where: Record<string, unknown>;
        select: { aContactId: true; bContactId: true };
      }): Promise<Array<{ aContactId: string; bContactId: string }>>;
      deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
      create(args: { data: Record<string, unknown> }): Promise<unknown>;
    };

    const rows = await delegate.findMany({
      where: { ownerId, OR: [{ aContactId: loserId }, { bContactId: loserId }] },
      select: { aContactId: true, bContactId: true },
    });

    // Rewritten rather than updated: the pair is the primary key, so the new
    // ordering is a different row.
    await delegate.deleteMany({
      where: { ownerId, OR: [{ aContactId: loserId }, { bContactId: loserId }] },
    });

    for (const row of rows) {
      const other = row.aContactId === loserId ? row.bContactId : row.aContactId;
      // The pair *between* these two is a judgement about one person now.
      if (other === winnerId) continue;
      const pair = orderedPair(winnerId, other);
      const exists = await delegate.findMany({
        where: { ownerId, ...pair },
        select: { aContactId: true, bContactId: true },
      });
      if (exists.length === 0) await delegate.create({ data: { ownerId, ...pair } });
    }
  }
}

/**
 * `CustomFieldValue.entityId` is not a foreign key, so nothing moves it and
 * nothing cascades it — every path handles it by hand, this one included.
 *
 * `@@unique([definitionId, entityId])`, so a definition both records answered
 * collides; the survivor's answer stands, because the caller resolved that
 * conflict on the review screen before getting here. `ROMANTIC` values key off
 * the *contact* id rather than the profile id — as `deleteContact` also has to
 * know — so they move on the same terms.
 */
async function moveCustomFieldValues(
  tx: Tx,
  ownerId: string,
  winnerId: string,
  loserId: string,
): Promise<void> {
  for (const entityType of ["CONTACT", "ROMANTIC"] as const) {
    const held = await tx.customFieldValue.findMany({
      where: { ownerId, entityType, entityId: winnerId },
      select: { definitionId: true },
    });
    await tx.customFieldValue.deleteMany({
      where: {
        ownerId,
        entityType,
        entityId: loserId,
        definitionId: { in: held.map((row) => row.definitionId) },
      },
    });
    await tx.customFieldValue.updateMany({
      where: { ownerId, entityType, entityId: loserId },
      data: { entityId: winnerId },
    });
  }
}
