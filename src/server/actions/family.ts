"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { type ActionResult, fail, ok, owner, str, strList } from "./helpers";
import { endFamilyPair } from "@/server/services/family-links";
import {
  contactPrivacyWhere,
  householdPrivacyWhere,
  privacyScope,
} from "@/server/privacy/filter";

/**
 * Households and family links.
 *
 * A household is deliberately an explicit, named group rather than something
 * derived from who shares an address: adult children who have moved out,
 * separations, lodgers and multi-generation homes all break that guess, and a
 * wrong guess about someone's family is worse than no guess at all.
 */

function touch(contactIds: Array<string | null | undefined> = []) {
  revalidatePath("/");
  revalidatePath("/family");
  for (const id of contactIds) {
    if (id) revalidatePath(`/people/${id}`);
  }
}

export async function createHousehold(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  const scope = await privacyScope();
  const name = str(form, "name");
  if (!name) return fail("Give the household a name.");

  const memberIds = [...new Set(strList(form, "memberIds"))];
  const members = memberIds.length
    ? await prisma.contact.findMany({
        where: { id: { in: memberIds }, ownerId, ...contactPrivacyWhere(scope) },
        select: { id: true },
      })
    : [];
  // Anything the scope dropped is refused rather than quietly left out. The
  // form can be rendered while unlocked with private people ticked and
  // submitted after the lock closes in another tab; saving the visible subset
  // reported success and created a household missing the members its owner
  // had just chosen, with nothing on screen to say so.
  if (members.length !== memberIds.length)
    return fail("Some of those people aren't available right now. Reopen the form and try again.");

  const existing = await prisma.household.findFirst({
    where: { ownerId, name },
    select: { id: true },
  });
  if (existing) return fail("You already have a household with that name.");

  const household = await prisma.household.create({
    data: {
      ownerId,
      name,
      notes: str(form, "notes") ?? null,
      members: {
        create: members.map((member, index) => ({
          contactId: member.id,
          sortOrder: index,
        })),
      },
    },
    select: { id: true },
  });

  touch(members.map((m) => m.id));
  return ok(household);
}

export async function updateHousehold(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  const name = str(form, "name");
  if (!id) return fail("Not found.");
  if (!name) return fail("Give the household a name.");

  const household = await prisma.household.findFirst({
    where: { id, ownerId, ...householdPrivacyWhere(await privacyScope()) },
    select: { id: true },
  });
  if (!household) return fail("Not found.");

  const clash = await prisma.household.findFirst({
    where: { ownerId, name, NOT: { id } },
    select: { id: true },
  });
  if (clash) return fail("You already have a household with that name.");

  await prisma.household.update({
    where: { id },
    data: { name, notes: str(form, "notes") ?? null },
  });

  touch();
  return ok();
}

export async function deleteHousehold(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const household = await prisma.household.findFirst({
    where: { id, ownerId, ...householdPrivacyWhere(await privacyScope()) },
    select: { members: { select: { contactId: true } } },
  });
  if (!household) return fail("Not found.");

  // Only the grouping goes; the people and their relationships are untouched.
  await prisma.household.delete({ where: { id } });

  touch(household.members.map((m) => m.contactId));
  return ok();
}

export async function addHouseholdMember(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const scope = await privacyScope();
  const householdId = str(form, "householdId");
  const contactId = str(form, "contactId");
  if (!householdId || !contactId) return fail("Pick someone to add.");

  const [household, contact] = await Promise.all([
    prisma.household.findFirst({
      where: { id: householdId, ownerId, ...householdPrivacyWhere(scope) },
      select: { id: true, _count: { select: { members: true } } },
    }),
    prisma.contact.findFirst({
      where: { id: contactId, ownerId, ...contactPrivacyWhere(scope) },
      select: { id: true },
    }),
  ]);
  if (!household || !contact) return fail("Not found.");

  await prisma.householdMember.upsert({
    where: { householdId_contactId: { householdId, contactId } },
    create: {
      householdId,
      contactId,
      role: str(form, "role") ?? null,
      sortOrder: household._count.members,
    },
    update: { role: str(form, "role") ?? null },
  });

  touch([contactId]);
  return ok();
}

export async function removeHouseholdMember(
  householdId: string,
  contactId: string,
): Promise<ActionResult> {
  const { ownerId } = await owner();
  const household = await prisma.household.findFirst({
    where: { id: householdId, ownerId, ...householdPrivacyWhere(await privacyScope()) },
    select: { id: true },
  });
  if (!household) return fail("Not found.");

  await prisma.householdMember.deleteMany({ where: { householdId, contactId } });

  touch([contactId]);
  return ok();
}

/**
 * Record a family link that was only ever a suggestion.
 *
 * This is the *only* path from inference to the database, and it runs because
 * someone pressed a button. The suggester itself never writes.
 *
 * The type is taken from the form rather than re-derived, so accepting a
 * suggested "sibling" as a half-sibling — which is the common correction —
 * needs no separate code path.
 */
export async function acceptSuggestion(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const scope = await privacyScope();
  const fromContactId = str(form, "fromContactId");
  const toContactId = str(form, "toContactId");
  const typeId = str(form, "typeId");
  if (!fromContactId || !toContactId || !typeId) return fail("Pick a relationship type.");
  if (fromContactId === toContactId) return fail("Someone can't be related to themselves.");

  const [from, to, type] = await Promise.all([
    prisma.contact.findFirst({ where: { id: fromContactId, ownerId, ...contactPrivacyWhere(scope) }, select: { id: true } }),
    prisma.contact.findFirst({ where: { id: toContactId, ownerId, ...contactPrivacyWhere(scope) }, select: { id: true } }),
    prisma.taxonomyTerm.findFirst({
      where: { id: typeId, ownerId, kind: "RELATIONSHIP_TYPE" },
      select: { id: true, inverseTermId: true },
    }),
  ]);
  if (!from || !to) return fail("Contact not found.");
  if (!type) return fail("Unknown relationship type.");

  const pairId = randomBytes(8).toString("hex");
  const inverseTypeId = type.inverseTermId ?? type.id;

  await prisma.$transaction(async (tx) => {
    await tx.relationship.upsert({
      where: {
        fromContactId_toContactId_typeId: { fromContactId, toContactId, typeId: type.id },
      },
      create: { ownerId, fromContactId, toContactId, typeId: type.id, pairId },
      update: { pairId },
    });
    await tx.relationship.upsert({
      where: {
        fromContactId_toContactId_typeId: {
          fromContactId: toContactId,
          toContactId: fromContactId,
          typeId: inverseTypeId,
        },
      },
      create: {
        ownerId,
        fromContactId: toContactId,
        toContactId: fromContactId,
        typeId: inverseTypeId,
        pairId,
      },
      update: { pairId },
    });
  });

  touch([fromContactId, toContactId]);
  return ok();
}

/**
 * Stop suggesting a pair without recording a relationship between them.
 *
 * Kept as a stored row rather than client state: a dismissal that comes back
 * the next time you open the page is worse than no dismissal at all.
 */
export async function dismissSuggestion(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const fromContactId = str(form, "fromContactId");
  const toContactId = str(form, "toContactId");
  if (!fromContactId || !toContactId) return fail("Not found.");

  const pair = await prisma.contact.findMany({
    where: {
      id: { in: [fromContactId, toContactId] },
      ownerId,
      ...contactPrivacyWhere(await privacyScope()),
    },
    select: { id: true },
  });
  if (pair.length !== 2) return fail("Not found.");

  await prisma.familySuggestionDismissal.upsert({
    where: {
      ownerId_aContactId_bContactId: {
        ownerId,
        ...orderedPair(fromContactId, toContactId),
      },
    },
    create: { ownerId, ...orderedPair(fromContactId, toContactId) },
    update: {},
  });

  touch([fromContactId, toContactId]);
  return ok();
}

/** Dismissals are stored once per unordered pair, smaller id first. */
function orderedPair(a: string, b: string): { aContactId: string; bContactId: string } {
  return a < b ? { aContactId: a, bContactId: b } : { aContactId: b, bContactId: a };
}

/**
 * Mark a relationship as ended — a divorce, a separation, a step-family that
 * came apart — without removing anyone.
 *
 * The work is in `endFamilyPair`; this checks ownership and turns its result
 * into something the form can show.
 */
export async function endRelationshipLink(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  if (!id) return fail("Not found.");

  const scope = await privacyScope();
  const existing = await prisma.relationship.findFirst({
    where: {
      id,
      ownerId,
      fromContact: contactPrivacyWhere(scope),
      toContact: contactPrivacyWhere(scope),
    },
    select: { pairId: true, fromContactId: true, toContactId: true },
  });
  if (!existing) return fail("Not found.");

  const result = await prisma.$transaction((tx) =>
    endFamilyPair(tx, ownerId, existing.pairId, str(form, "notes")),
  );

  if (!result.ok) {
    if (result.reason === "cannot-end") {
      return fail("That relationship can't be ended — only marriages, in-laws and step relations can.");
    }
    if (result.reason === "no-former-term") {
      return fail("The matching 'former' relationship types are missing from your taxonomy.");
    }
    return fail("Not found.");
  }

  touch([existing.fromContactId, existing.toContactId]);
  return ok();
}
