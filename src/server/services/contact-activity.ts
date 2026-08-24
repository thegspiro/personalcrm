import { Prisma } from "@prisma/client";
import { computeNextTouchAt } from "@/lib/cadence";

type Tx = Prisma.TransactionClient;

/**
 * Maintains the denormalised activity fields on Contact.
 *
 * This is the only place `lastInteractionAt` and `nextTouchAt` are written, and
 * it always derives them from the full interaction history rather than from
 * whichever row was just touched. That distinction is the whole point:
 *
 *   Logging a coffee you had three months ago must NOT make it look like you
 *   spoke today. Setting `lastInteractionAt = newInteraction.occurredAt` would
 *   do exactly that, and would quietly clear the person off your overdue list.
 *
 * Deleting the most recent interaction has the mirror-image problem — the field
 * has to fall back to the one before it, not stay stale.
 *
 * Future-dated interactions (a dinner you have planned) are excluded: they are
 * something you are going to do, not something you have done.
 */
export async function recomputeContactActivity(
  tx: Tx,
  contactIds: string[],
  now: Date = new Date(),
): Promise<void> {
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (ids.length === 0) return;

  const contacts = await tx.contact.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      cadenceDays: true,
      snoozedUntil: true,
      createdAt: true,
      lastInteractionAt: true,
      nextTouchAt: true,
    },
  });

  // MAX(occurredAt) per contact in one grouped query. Prisma's groupBy cannot
  // aggregate across the join to Interaction, so this drops to SQL rather than
  // pulling every interaction into memory to reduce it here.
  const maxRows = await tx.$queryRaw<Array<{ contactId: string; lastAt: Date | null }>>`
    SELECT ip.contactId AS contactId, MAX(i.occurredAt) AS lastAt
    FROM InteractionParticipant ip
    JOIN Interaction i ON i.id = ip.interactionId
    WHERE ip.contactId IN (${Prisma.join(ids)})
      AND i.occurredAt <= ${now}
    GROUP BY ip.contactId
  `;

  const lastByContact = new Map<string, Date>();
  for (const row of maxRows) {
    if (row.lastAt) lastByContact.set(row.contactId, new Date(row.lastAt));
  }

  for (const contact of contacts) {
    const lastInteractionAt = lastByContact.get(contact.id) ?? null;
    const nextTouchAt = computeNextTouchAt({
      cadenceDays: contact.cadenceDays,
      lastInteractionAt,
      snoozedUntil: contact.snoozedUntil,
      createdAt: contact.createdAt,
    });

    // Skip the write when nothing moved — backdating an old interaction leaves
    // most contacts untouched, and this keeps that a no-op.
    if (
      sameInstant(contact.lastInteractionAt, lastInteractionAt) &&
      sameInstant(contact.nextTouchAt, nextTouchAt)
    ) {
      continue;
    }

    await tx.contact.update({
      where: { id: contact.id },
      data: { lastInteractionAt, nextTouchAt },
    });
  }
}

/** Every contact who took part in the given interactions. */
export async function participantsOf(tx: Tx, interactionIds: string[]): Promise<string[]> {
  if (interactionIds.length === 0) return [];
  const rows = await tx.interactionParticipant.findMany({
    where: { interactionId: { in: interactionIds } },
    select: { contactId: true },
  });
  return [...new Set(rows.map((r) => r.contactId))];
}

/**
 * Renumber a contact's dates by when they happened.
 *
 * `DateEntry.sequence` means "nth date with this person", so remembering a
 * date you forgot to log has to push the later ones up rather than being
 * appended as the newest.
 */
export async function resequenceDateEntries(tx: Tx, contactId: string): Promise<void> {
  const entries = await tx.dateEntry.findMany({
    where: { contactId },
    select: { id: true, sequence: true, interaction: { select: { occurredAt: true } } },
  });

  const ordered = [...entries].sort(
    (a, b) => a.interaction.occurredAt.getTime() - b.interaction.occurredAt.getTime(),
  );

  for (const [index, entry] of ordered.entries()) {
    const sequence = index + 1;
    if (entry.sequence === sequence) continue;
    await tx.dateEntry.update({ where: { id: entry.id }, data: { sequence } });
  }
}

function sameInstant(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.getTime() === b.getTime();
}
