import "server-only";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Multi-step writes over associates, shared by the associate actions, the
 * contact delete path and contact merge.
 *
 * Each takes a transaction client: every one of them reads rows and then
 * writes on the strength of what it read, and outside a transaction a second
 * tab could link, unlink or merge in between.
 */

/**
 * Delete the associates that are about to be left with no one.
 *
 * Called *before* the contacts go, because afterwards their links have already
 * cascaded away and an associate with no links is indistinguishable from one
 * that never had any. An associate that also lives in someone else's life
 * stays — it just loses this link — which is the whole point of sharing them.
 *
 * Without this a deleted friend's colleague would linger on the roll-up under
 * nobody, readable only with the lock open (a link to someone visible is what
 * makes an associate visible), and impossible to reach to remove.
 */
export async function sweepOrphanedAssociates(
  tx: Tx,
  ownerId: string,
  contactIds: string[],
): Promise<number> {
  if (contactIds.length === 0) return 0;
  const orphans = await tx.associate.findMany({
    where: {
      ownerId,
      links: {
        some: { contactId: { in: contactIds } },
        every: { contactId: { in: contactIds } },
      },
    },
    select: { id: true },
  });
  if (orphans.length === 0) return 0;
  const { count } = await tx.associate.deleteMany({
    where: { ownerId, id: { in: orphans.map((row) => row.id) } },
  });
  return count;
}

/**
 * Move every link from one contact to another, as contact merge needs.
 *
 * The link's key is `(associateId, contactId)`, so an associate already in
 * the survivor's life cannot simply be re-pointed — that would be a duplicate
 * key. It keeps the survivor's link, borrowing the loser's wording only when
 * the survivor's had none, and the loser's is dropped.
 */
export async function moveAssociateLinks(
  tx: Tx,
  ownerId: string,
  fromContactId: string,
  toContactId: string,
): Promise<void> {
  const [from, to] = await Promise.all([
    tx.associateLink.findMany({
      where: { ownerId, contactId: fromContactId },
      select: { associateId: true, howTheyKnow: true },
    }),
    tx.associateLink.findMany({
      where: { ownerId, contactId: toContactId },
      select: { associateId: true, howTheyKnow: true },
    }),
  ]);
  const held = new Map(to.map((link) => [link.associateId, link]));

  for (const link of from) {
    const existing = held.get(link.associateId);
    if (existing) {
      if (!existing.howTheyKnow && link.howTheyKnow) {
        await tx.associateLink.update({
          where: {
            associateId_contactId: { associateId: link.associateId, contactId: toContactId },
          },
          data: { howTheyKnow: link.howTheyKnow },
        });
      }
      await tx.associateLink.delete({
        where: {
          associateId_contactId: { associateId: link.associateId, contactId: fromContactId },
        },
      });
    } else {
      await tx.associateLink.update({
        where: {
          associateId_contactId: { associateId: link.associateId, contactId: fromContactId },
        },
        data: { contactId: toContactId },
      });
    }
  }
}

export type AssociateMergeRefusal = "not-found" | "same-associate" | "both-promoted";

/**
 * Fold one associate into another: "these are the same person".
 *
 * Everything the dropped entry carried survives on the kept one — its links
 * (merged as `moveAssociateLinks` merges them, the kept wording winning), every
 * note with its source intact, and the promotion pointer when only the dropped
 * entry had one. Only the duplicate row itself goes.
 *
 * Refuses when both were promoted into *different* people: picking one would
 * silently un-track the other, and that is a contact merge, not this.
 *
 * Privacy only ever widens: the kept entry is private if either was, because
 * folding a hidden entry's notes into a visible one would publish them.
 *
 * Both rows are locked first. A plain read inside a transaction is a
 * non-locking snapshot under MariaDB's default isolation, so without
 * `FOR UPDATE` a second tab could merge the same pair the other way round and
 * each would delete the row the other kept.
 */
export async function mergeAssociateInto(
  tx: Tx,
  ownerId: string,
  keepId: string,
  dropId: string,
): Promise<{ ok: true } | { ok: false; refusal: AssociateMergeRefusal }> {
  if (keepId === dropId) return { ok: false, refusal: "same-associate" };

  const locked = await tx.$queryRaw<
    { id: string; isPrivate: number; promotedContactId: string | null }[]
  >`SELECT id, isPrivate, promotedContactId
      FROM Associate
     WHERE ownerId = ${ownerId} AND id IN (${keepId}, ${dropId})
     ORDER BY id
       FOR UPDATE`;
  const keep = locked.find((row) => row.id === keepId);
  const drop = locked.find((row) => row.id === dropId);
  if (!keep || !drop) return { ok: false, refusal: "not-found" };

  if (
    keep.promotedContactId &&
    drop.promotedContactId &&
    keep.promotedContactId !== drop.promotedContactId
  ) {
    return { ok: false, refusal: "both-promoted" };
  }

  const [dropLinks, keepLinks] = await Promise.all([
    tx.associateLink.findMany({
      where: { ownerId, associateId: dropId },
      select: { contactId: true, howTheyKnow: true },
    }),
    tx.associateLink.findMany({
      where: { ownerId, associateId: keepId },
      select: { contactId: true, howTheyKnow: true },
    }),
  ]);
  const held = new Map(keepLinks.map((link) => [link.contactId, link]));

  for (const link of dropLinks) {
    const existing = held.get(link.contactId);
    if (existing) {
      if (!existing.howTheyKnow && link.howTheyKnow) {
        await tx.associateLink.update({
          where: { associateId_contactId: { associateId: keepId, contactId: link.contactId } },
          data: { howTheyKnow: link.howTheyKnow },
        });
      }
      // The dropped row's own link goes with it when it is deleted below.
    } else {
      await tx.associateLink.update({
        where: { associateId_contactId: { associateId: dropId, contactId: link.contactId } },
        data: { associateId: keepId },
      });
    }
  }

  await tx.associateNote.updateMany({
    where: { ownerId, associateId: dropId },
    data: { associateId: keepId },
  });

  await tx.associate.update({
    where: { id: keepId },
    data: {
      isPrivate: Boolean(keep.isPrivate) || Boolean(drop.isPrivate),
      promotedContactId: keep.promotedContactId ?? drop.promotedContactId,
    },
  });
  await tx.associate.delete({ where: { id: dropId } });

  return { ok: true };
}

/** One "they talked about…" line from the interaction form, already validated. */
export interface InteractionAssociateMention {
  /** An existing associate, or — with `name` instead — someone new. */
  associateId?: string;
  name?: string;
  heardFromContactId: string;
  content: string;
}

/** Thrown when an associate named in the form was promoted, unlinked or deleted meanwhile. */
export class AssociateMentionStale extends Error {}

/**
 * Lock every existing associate the lines name, still a note and still in the
 * source's life, or throw `AssociateMentionStale`.
 *
 * **The first thing the transaction does**, before the interaction is written
 * or its place resolved. From MariaDB 11.6.2 a locking read of a row that
 * changed after the transaction's read snapshot was taken does not wait and
 * see — it raises 1020 and rolls the whole transaction back. A snapshot is
 * taken by the first plain read, so locking after `resolveLocation` turned a
 * promotion landing mid-save into exactly that error. Taken first, there is no
 * snapshot yet: the read waits for the promoting transaction, sees the
 * committed promotion, and refuses cleanly. Found by CI, which runs 11; the
 * development database is 10.11 and never raises it.
 *
 * The lock is the one `promoteAssociate` takes, so a promotion cannot begin
 * once this holds it either. Ids are locked in a fixed order, so two saves
 * naming the same people cannot each hold one the other is waiting for.
 */
export async function lockMentionedAssociates(
  tx: Tx,
  ownerId: string,
  mentions: InteractionAssociateMention[],
): Promise<void> {
  const ids = [...new Set(mentions.flatMap((row) => (row.associateId ? [row.associateId] : [])))].sort();
  for (const id of ids) {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM Associate
       WHERE id = ${id} AND ownerId = ${ownerId} AND promotedContactId IS NULL
         FOR UPDATE`;
    if (!locked) throw new AssociateMentionStale();
  }
  for (const row of mentions) {
    if (!row.associateId) continue;
    const linked = await tx.associateLink.count({
      where: { ownerId, associateId: row.associateId, contactId: row.heardFromContactId },
    });
    if (!linked) throw new AssociateMentionStale();
  }
}

/**
 * Write the news heard in a logged conversation, inside the transaction that
 * logs it.
 *
 * Each line becomes an update dated to the conversation, heard from the
 * participant who said it, and pointing back at the interaction. A new name
 * becomes an associate in that participant's life. Inside the same
 * transaction as the interaction rather than after it, so a save that fails
 * leaves neither, and a `transact` retry writes both again from scratch rather
 * than a second copy of the notes.
 *
 * Expects `lockMentionedAssociates` to have run first in the same transaction;
 * the action validated every id before the transaction opened, and that lock
 * is what makes the check still true here.
 */
export async function writeInteractionAssociateMentions(
  tx: Tx,
  ownerId: string,
  interactionId: string,
  date: Date,
  mentions: InteractionAssociateMention[],
): Promise<void> {
  for (const mention of mentions) {
    let associateId = mention.associateId;
    if (!associateId) {
      const created = await tx.associate.create({
        data: {
          ownerId,
          name: mention.name!,
          links: { create: { contactId: mention.heardFromContactId } },
        },
      });
      associateId = created.id;
    }

    await tx.associateNote.create({
      data: {
        ownerId,
        associateId,
        kind: "UPDATE",
        content: mention.content,
        date,
        precision: "DAY",
        heardFromContactId: mention.heardFromContactId,
        sourceInteractionId: interactionId,
      },
    });
  }
}

/**
 * Delete the notes heard in conversations the lock would withhold, before
 * those conversations are deleted.
 *
 * The note's link to its conversation is `SET NULL`, so an ordinary deleted
 * conversation leaves its notes, as asked. But a note from a private one —
 * marked private, or with a private participant or mention — is hidden only
 * *because* of that conversation, and `SET NULL` would leave it with nothing
 * hiding it: the next closed lock would show it. So those go with it, the way
 * a note heard from a deleted friend goes with them.
 */
export async function sweepWithheldInteractionNotes(
  tx: Tx,
  ownerId: string,
  interactionIds: string[],
): Promise<number> {
  if (interactionIds.length === 0) return 0;
  const { count } = await tx.associateNote.deleteMany({
    where: {
      ownerId,
      sourceInteractionId: { in: interactionIds },
      sourceInteraction: {
        OR: [
          { isPrivate: true },
          { participants: { some: { contact: { isPrivate: true } } } },
          { mentions: { some: { contact: { isPrivate: true } } } },
        ],
      },
    },
  });
  return count;
}
