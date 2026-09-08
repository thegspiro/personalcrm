"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { transact } from "@/server/db/transaction";
import { contactPrivacyWhere, privacyScope } from "@/server/privacy/filter";
import { requireUnlocked } from "@/server/privacy/lock";
import { removeAvatarFile } from "@/server/services/avatars";
import {
  mergeContacts,
  type MergeableField,
  type MergeFields,
} from "@/server/services/contact-merge";
import { orderedPair } from "@/lib/duplicates";
import { pairedField } from "@/lib/merge-fields";
import { createLogger } from "@/server/log";
import { fail, ok, owner, type ActionResult } from "./helpers";

const log = createLogger("duplicates");

/**
 * Merging two contacts, and saying two are not the same person.
 *
 * Both are lock-gated. A merge can move private rows and can make a public
 * record private, and neither is something to do on behalf of somebody who
 * cannot currently see what they are merging.
 *
 * The form sends a **side** per field, never a value. That is the whole reason
 * this cannot be used to write arbitrary data into a contact: the server reads
 * the value off whichever record was chosen, so the worst a crafted request can
 * do is pick the other person's real answer — which is a thing the screen
 * offers anyway. Invariant 4, and the version of it that does not rely on
 * validating a payload field by field.
 */

/** Every column the screen may offer a choice for. Anything else is ignored. */
const CHOOSABLE = [
  "firstName",
  "lastName",
  "nickname",
  "pronouns",
  "avatarPath",
  "categoryId",
  "birthDate",
  "birthDatePrecision",
  "howWeMet",
  "whereWeMet",
  "metOn",
  "metOnPrecision",
  "meetingSourceId",
  "occupation",
  "employer",
  "city",
  "region",
  "country",
  "timezone",
  "summary",
  "isFavorite",
  "cadenceDays",
] as const satisfies readonly MergeableField[];

const mergeSchema = z.object({
  winnerId: z.string().min(1),
  loserId: z.string().min(1),
  /**
   * field → which record's answer to keep.
   *
   * `partialRecord`, not `record`. In Zod 4 a record keyed by an enum is
   * *exhaustive*: it requires every member as a key, so this refused every
   * merge that did not answer for all twenty-two columns — which is every
   * merge, since only the fields that genuinely disagree are ever asked about.
   * The refusal surfaced as "that merge could not be read" and nothing in the
   * server log, which is exactly as much help as it sounds.
   */
  choices: z.partialRecord(z.enum(CHOOSABLE), z.enum(["winner", "loser"])),
});

export async function mergeDuplicate(form: FormData): Promise<ActionResult> {
  const guard = await requireUnlocked();
  if (!guard.ok) return fail(guard.error);

  let choices: Record<string, "winner" | "loser"> = {};
  try {
    const raw = form.get("choices");
    choices = typeof raw === "string" && raw ? JSON.parse(raw) : {};
  } catch {
    return fail("That merge could not be read. Try again.");
  }

  const parsed = mergeSchema.safeParse({
    winnerId: form.get("winnerId"),
    loserId: form.get("loserId"),
    choices,
  });
  if (!parsed.success) return fail("That merge could not be read. Try again.");

  const { ownerId } = await owner();
  const scope = await privacyScope();
  const where = contactPrivacyWhere(scope);

  const pair = await prisma.contact.findMany({
    where: { AND: [{ ownerId, id: { in: [parsed.data.winnerId, parsed.data.loserId] } }, where] },
  });
  if (pair.length !== 2) return fail("Those people could not be found.");

  const winner = pair.find((row) => row.id === parsed.data.winnerId)!;
  const loser = pair.find((row) => row.id === parsed.data.loserId)!;

  // The value comes off the chosen record, never off the request.
  const fields: MergeFields = {};
  for (const [field, side] of Object.entries(parsed.data.choices)) {
    const source = side === "loser" ? loser : winner;
    (fields as Record<string, unknown>)[field] = source[field as keyof typeof source];

    // Invariant 8: a partial date stays partial. The precision travels with the
    // day it qualifies — enforced here rather than in the form, so a request
    // that names one without the other cannot take this record's day and that
    // record's precision and turn "sometime in 2019" into a Tuesday.
    const paired = pairedField(field);
    if (paired) {
      (fields as Record<string, unknown>)[paired] = source[paired as keyof typeof source];
    }
  }

  const result = await transact((tx) =>
    mergeContacts(tx, ownerId, {
      winnerId: parsed.data.winnerId,
      loserId: parsed.data.loserId,
      fields,
    }, where),
  );

  if (!result.ok) {
    if (result.refusal === "both-romantic") {
      return fail(
        "Both of these have a dating profile. Merging would discard one, so remove the one you do not want first.",
      );
    }
    if (result.refusal === "same-contact") return fail("That is the same person twice.");
    return fail("Those people could not be found.");
  }

  // After the transaction, and never inside it: an unlinked file cannot be
  // rolled back, so a failure after this point would leave a record pointing
  // at nothing. An orphaned file is the safe direction.
  if (result.discardedAvatarPath) {
    await removeAvatarFile(result.discardedAvatarPath).catch((error) => {
      log.error("could not remove a merged-away avatar", error);
    });
  }

  revalidatePath("/people");
  revalidatePath("/settings");
  return ok();
}

const dismissSchema = z.object({
  aContactId: z.string().min(1),
  bContactId: z.string().min(1),
});

/** Record that two people are not the same, so the scan stops offering them. */
export async function dismissDuplicate(form: FormData): Promise<ActionResult> {
  const guard = await requireUnlocked();
  if (!guard.ok) return fail(guard.error);

  const parsed = dismissSchema.safeParse({
    aContactId: form.get("aContactId"),
    bContactId: form.get("bContactId"),
  });
  if (!parsed.success) return fail("That could not be read.");
  if (parsed.data.aContactId === parsed.data.bContactId) return fail("That is one person.");

  const { ownerId } = await owner();
  const scope = await privacyScope();

  const pair = await prisma.contact.findMany({
    where: {
      ownerId,
      id: { in: [parsed.data.aContactId, parsed.data.bContactId] },
      ...contactPrivacyWhere(scope),
    },
    select: { id: true },
  });
  if (pair.length !== 2) return fail("Those people could not be found.");

  const ordered = orderedPair(parsed.data.aContactId, parsed.data.bContactId);
  await prisma.duplicateDismissal.upsert({
    where: { ownerId_aContactId_bContactId: { ownerId, ...ordered } },
    create: { ownerId, ...ordered },
    update: {},
  });

  revalidatePath("/settings");
  return ok();
}
