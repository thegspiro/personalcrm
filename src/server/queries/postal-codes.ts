import "server-only";
import { prisma } from "@/server/db/client";
import { foldPostalCode } from "@/lib/postal-codes";

/**
 * Reading the imported postal codes.
 *
 * No `ownerId` anywhere here, and that is the whole character of this table: it
 * holds published reference data, identical for every account, so there is
 * nothing to scope and nothing to disclose. Every other query in this directory
 * is owner-scoped because it reads somebody's records; a postal code is not
 * anybody's record.
 */

/** Enough to show a choice, few enough that a bad code cannot return a page. */
const MATCH_CAP = 10;

export interface PostalPlace {
  country: string;
  place: string;
  region: string | null;
}

export interface PostalSource {
  country: string;
  rows: number;
  importedAt: Date;
}

/**
 * Every place a postal code names, across whatever has been imported.
 *
 * Searched by code alone rather than by country. An address here holds its
 * country as free text — "United States", "USA", "us" — while this table is
 * keyed by ISO code, and there is no mapping between the two. Searching
 * everything and refusing to guess between answers is honest; inventing a
 * mapping to narrow the search would be the guess.
 */
export async function findPostalPlaces(code: string): Promise<PostalPlace[]> {
  const lookup = foldPostalCode(code);
  if (!lookup) return [];

  const rows = await prisma.postalCode.findMany({
    where: { lookup },
    select: { country: true, place: true, region: true },
    orderBy: [{ country: "asc" }, { place: "asc" }],
    take: MATCH_CAP,
  });
  return rows;
}

export async function listPostalSources(): Promise<PostalSource[]> {
  return prisma.postalCodeSource.findMany({
    select: { country: true, rows: true, importedAt: true },
    orderBy: { country: "asc" },
  });
}

/** Whether the address form should offer to fill anything in at all. */
export async function hasPostalCodes(): Promise<boolean> {
  return (await prisma.postalCodeSource.count()) > 0;
}
