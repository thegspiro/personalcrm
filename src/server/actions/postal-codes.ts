"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { parsePostalCodeFile, POSTAL_CODE_LIMIT } from "@/lib/postal-codes";
import { findPostalPlaces, type PostalPlace } from "@/server/queries/postal-codes";
import { type ActionResult, fail, isAdmin, ok, owner, str } from "./helpers";

/**
 * Importing a country's postal codes, and reading them back.
 *
 * The data is published by GeoNames under CC BY 4.0 and is the same for
 * everybody, so it is stored per *installation* rather than per account — which
 * is why both writes are administrator-only, the same reasoning as the address
 * lookup's endpoint. Nothing here is owner-scoped because there is nothing here
 * that belongs to an owner.
 *
 * Nothing is fetched. The operator downloads the country file from GeoNames and
 * uploads it, so an installation with no outbound network at all can still fill
 * in a city from a postal code — which was the entire point of storing this
 * rather than asking a geocoder.
 */

/** Rows per insert. Large enough to be quick, small enough to fit a packet. */
const BATCH = 1_000;

/** A file past this is not a country file, and reading it would cost memory. */
const MAX_BYTES = 8 * 1024 * 1024;

export async function importPostalCodes(
  form: FormData,
): Promise<ActionResult<{ country: string; rows: number; skipped: number }>> {
  await owner();
  if (!(await isAdmin())) return fail("Only an administrator can change this.");

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail("Choose the country file you downloaded from GeoNames.");
  }
  if (file.size > MAX_BYTES) {
    return fail(
      "That file is larger than a single country's. Import one country at a time — allCountries.txt is not what this wants.",
    );
  }

  const parsed = parsePostalCodeFile(await file.text());
  if (!parsed.ok) {
    if (parsed.reason === "mixed") {
      return fail(
        `That file holds more than one country (${parsed.detail}). Import one at a time, so each can be replaced on its own.`,
      );
    }
    if (parsed.reason === "too-many") {
      return fail(
        `That file holds more than ${POSTAL_CODE_LIMIT.toLocaleString("en-US")} postal codes, which is more than any one country has.`,
      );
    }
    return fail(
      "Nothing in that file read as a postal code. It should be the unzipped .txt from GeoNames, tab separated.",
    );
  }

  const { country, rows, skipped } = parsed;

  // Replaced rather than merged: a re-import is how a country is brought up to
  // date, and merging would leave codes that the new file has dropped.
  //
  // Deliberately not one transaction. Forty thousand rows takes long enough
  // that a single transaction would sit well past Prisma's timeout, and the
  // failure mode of doing it in batches is benign — the source row is written
  // last, so an interrupted import reads as "not imported" and the next one
  // replaces whatever landed.
  await prisma.postalCode.deleteMany({ where: { country } });
  for (let at = 0; at < rows.length; at += BATCH) {
    await prisma.postalCode.createMany({ data: rows.slice(at, at + BATCH) });
  }
  await prisma.postalCodeSource.upsert({
    where: { country },
    create: { country, rows: rows.length, importedAt: new Date() },
    update: { rows: rows.length, importedAt: new Date() },
  });

  revalidatePath("/settings");
  return ok({ country, rows: rows.length, skipped });
}

export async function clearPostalCodes(form: FormData): Promise<ActionResult> {
  await owner();
  if (!(await isAdmin())) return fail("Only an administrator can change this.");

  const country = (str(form, "country") ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return fail("Which country?");

  await prisma.postalCode.deleteMany({ where: { country } });
  await prisma.postalCodeSource.deleteMany({ where: { country } });

  revalidatePath("/settings");
  return ok();
}

/**
 * What a postal code names, for an address form to fill in.
 *
 * Signed in, but not administrator-only and not owner-scoped: this reads
 * published reference data, so there is nothing here that one account could
 * learn about another. It is still an action rather than a client-side lookup,
 * because forty thousand rows do not belong in a page.
 */
export async function lookupPostalCode(
  form: FormData,
): Promise<ActionResult<{ places: PostalPlace[] }>> {
  await owner();

  const code = str(form, "code");
  if (!code) return ok({ places: [] });

  return ok({ places: await findPostalPlaces(code) });
}
