import "server-only";
import { prisma } from "@/server/db/client";
import { contactPrivacyWhere } from "@/server/privacy/where";
import { privacyScope } from "@/server/privacy/filter";
import { pointOf, unitOf, type Point, type Unit } from "@/lib/geo";

/**
 * Where distances are measured from.
 *
 * Two origins, because the two questions a plan raises are different ones:
 * "how far is that from me?" and "is that anywhere near her?". Both are
 * optional — an account that has never placed an address has neither, and every
 * caller renders nothing rather than a zero.
 */
export interface Origins {
  /** The account's own home base, from `UserPreference`. */
  home: Point | null;
  /** The contact's first placed address, when one was asked for. */
  contact: Point | null;
  unit: Unit;
}

/**
 * The contact half is owner-scoped and lock-checked in the query, not after it.
 *
 * A private contact's coordinates are as much a disclosure as their name: a
 * point on a map that appears only while the lock is open is itself an answer.
 * So the contact is fetched through `contactPrivacyWhere`, and a locked private
 * person yields no origin — the section simply is not there, exactly as if they
 * had no address at all.
 */
export async function originsFor(
  ownerId: string,
  contactId?: string,
): Promise<Origins> {
  const scope = await privacyScope();

  const [prefs, address] = await Promise.all([
    prisma.userPreference.findUnique({
      where: { userId: ownerId },
      select: { homeLatitude: true, homeLongitude: true, distanceUnit: true },
    }),
    contactId
      ? prisma.address.findFirst({
          where: {
            contactId,
            contact: { ownerId, ...contactPrivacyWhere(scope) },
            latitude: { not: null },
            longitude: { not: null },
          },
          // The same order the addresses section renders in, so "their address"
          // means the one at the top of their page rather than an arbitrary row.
          orderBy: [{ label: "asc" }, { id: "asc" }],
          select: { latitude: true, longitude: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    home: pointOf({ latitude: prefs?.homeLatitude, longitude: prefs?.homeLongitude }),
    contact: pointOf(address),
    unit: unitOf(prefs?.distanceUnit),
  };
}
