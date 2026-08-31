import "server-only";
import { prisma } from "@/server/db/client";
import { interactionPrivacyWhere, privacyScope } from "@/server/privacy/filter";

export interface LocationSummary {
  id: string;
  displayName: string;
  address: string | null;
  details: string | null;
  visitCount: number;
  participantCount: number;
}

/** Counts are calculated only from rows which the interaction privacy filter admits. */
export async function listLocations(ownerId: string): Promise<LocationSummary[]> {
  const scope = await privacyScope();
  const rows = await prisma.location.findMany({
    where: { ownerId, interactions: { some: { ownerId, ...interactionPrivacyWhere(scope) } } },
    select: {
      id: true, displayName: true, address: true, details: true,
      interactions: {
        where: { ownerId, ...interactionPrivacyWhere(scope) },
        select: { participants: { select: { contactId: true } } },
      },
    },
    orderBy: { displayName: "asc" },
  });
  return rows.map(({ interactions, ...location }) => ({
    ...location,
    visitCount: interactions.length,
    participantCount: new Set(interactions.flatMap((row) => row.participants.map((p) => p.contactId))).size,
  }));
}

export async function getLocationHistory(ownerId: string, id: string) {
  const scope = await privacyScope();
  const location = await prisma.location.findFirst({
    where: { id, ownerId, interactions: { some: { ownerId, ...interactionPrivacyWhere(scope) } } },
    select: {
      id: true, displayName: true, address: true, details: true,
      interactions: {
        where: { ownerId, ...interactionPrivacyWhere(scope) },
        orderBy: { occurredAt: "desc" },
        select: {
          id: true, occurredAt: true, title: true, notes: true, location: true,
          type: { select: { label: true } },
          participants: { select: { contact: { select: { id: true, firstName: true, lastName: true } } } },
        },
      },
    },
  });
  if (!location) return null;
  const contacts = new Map<string, { id: string; firstName: string; lastName: string | null }>();
  for (const interaction of location.interactions) {
    for (const { contact } of interaction.participants) contacts.set(contact.id, contact);
  }
  return { ...location, contacts: [...contacts.values()] };
}
