import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

const { mergeContacts } = await import("@/server/services/contact-merge");
type MergeFields = import("@/server/services/contact-merge").MergeFields;

/**
 * Folding one contact into another.
 *
 * The merge is irreversible and there is no soft delete, so the failure this
 * suite exists to catch is not a wrong answer — it is a *silent* one. A
 * relation nobody remembered to move goes over the cascade with the losing
 * record, and nobody finds out until they go looking for a birthday that is no
 * longer there.
 *
 * So the shape here is: give the losing contact a row in every table that can
 * hold one, merge, and assert the survivor holds them all and the loser holds
 * nothing.
 */
describe.skipIf(!hasTestDatabase)("merging two contacts", () => {
  let ownerId: string;
  let winnerId: string;
  let loserId: string;

  async function contact(firstName: string, over: Record<string, unknown> = {}) {
    const row = await prisma.contact.create({ data: { ownerId, firstName, ...over } });
    return row.id;
  }

  function merge(fields: MergeFields = {}) {
    return prisma.$transaction((tx) =>
      mergeContacts(tx, ownerId, { winnerId, loserId, fields }, {}),
    );
  }

  beforeEach(async () => {
    await reset();
    ownerId = (await createTestUser()).id;
    winnerId = await contact("Keeper");
    loserId = await contact("Loser");
  });
  afterAll(() => prisma.$disconnect());

  describe("nothing is left behind", () => {
    it("moves a row from every table that can hold one", async () => {
      const [tag, household, other] = await Promise.all([
        prisma.tag.create({ data: { ownerId, name: "Tag", slug: "tag" } }),
        prisma.household.create({ data: { ownerId, name: "House" } }),
        contact("Someone Else"),
      ]);
      const relType = await prisma.taxonomyTerm.findFirstOrThrow({
        where: { ownerId, kind: "RELATIONSHIP_TYPE" },
      });
      const definition = await prisma.customFieldDefinition.create({
        data: { ownerId, entity: "CONTACT", key: "k", label: "K", fieldType: "TEXT" },
      });
      const interaction = await prisma.interaction.create({
        data: { ownerId, title: "Coffee", occurredAt: new Date("2026-01-02T10:00:00Z") },
      });
      const lifeEvent = await prisma.lifeEvent.create({
        data: { ownerId, contactId: other, title: "Wedding", date: new Date("2026-01-02") },
      });

      await Promise.all([
        prisma.contactMethod.create({ data: { contactId: loserId, value: "a@b.com" } }),
        prisma.address.create({ data: { contactId: loserId, line1: "1 Road" } }),
        prisma.fact.create({ data: { ownerId, contactId: loserId, content: "Likes tea" } }),
        prisma.importantDate.create({
          data: { ownerId, contactId: loserId, label: "Anniversary", date: new Date("2026-03-04") },
        }),
        prisma.gift.create({ data: { ownerId, contactId: loserId, name: "Book" } }),
        prisma.debt.create({
          data: {
            ownerId,
            contactId: loserId,
            direction: "THEY_OWE_ME",
            description: "Lunch",
            incurredOn: new Date("2026-01-01"),
          },
        }),
        prisma.dietaryNeed.create({
          data: { ownerId, contactId: loserId, kind: "ALLERGY", label: "Nuts" },
        }),
        prisma.flag.create({
          data: { ownerId, contactId: loserId, kind: "GREEN", text: "Kind" },
        }),
        prisma.happening.create({
          data: { ownerId, contactId: loserId, title: "Away", date: new Date("2026-05-01") },
        }),
        prisma.lifeEvent.create({
          data: { ownerId, contactId: loserId, title: "Moved", date: new Date("2026-02-01") },
        }),
        prisma.idea.create({ data: { ownerId, contactId: loserId, content: "Go walking" } }),
        prisma.task.create({ data: { ownerId, contactId: loserId, title: "Call" } }),
        prisma.plan.create({ data: { ownerId, contactId: loserId, title: "Dinner" } }),
        prisma.contactTag.create({ data: { ownerId, contactId: loserId, tagId: tag.id } }),
        prisma.householdMember.create({
          data: { ownerId, contactId: loserId, householdId: household.id },
        }),
        prisma.associate.create({ data: { ownerId, contactId: loserId, name: "Their friend" } }),
        prisma.interactionParticipant.create({
          data: { ownerId, contactId: loserId, interactionId: interaction.id },
        }),
        prisma.interactionMention.create({
          data: { ownerId, contactId: loserId, interactionId: interaction.id },
        }),
        prisma.lifeEventParticipant.create({
          data: { ownerId, contactId: loserId, lifeEventId: lifeEvent.id },
        }),
        prisma.relationship.create({
          data: {
            ownerId,
            fromContactId: loserId,
            toContactId: other,
            typeId: relType.id,
            pairId: "pair-1",
          },
        }),
        prisma.romanticProfile.create({ data: { ownerId, contactId: loserId } }),
        prisma.customFieldValue.create({
          data: {
            ownerId,
            definitionId: definition.id,
            entityType: "CONTACT",
            entityId: loserId,
            value: "kept",
          },
        }),
      ]);

      const result = await merge();
      expect(result.ok).toBe(true);

      // Everything is the survivor's now.
      const counts = await Promise.all([
        prisma.contactMethod.count({ where: { contactId: winnerId } }),
        prisma.address.count({ where: { contactId: winnerId } }),
        prisma.fact.count({ where: { contactId: winnerId } }),
        prisma.importantDate.count({ where: { contactId: winnerId } }),
        prisma.gift.count({ where: { contactId: winnerId } }),
        prisma.debt.count({ where: { contactId: winnerId } }),
        prisma.dietaryNeed.count({ where: { contactId: winnerId } }),
        prisma.flag.count({ where: { contactId: winnerId } }),
        prisma.happening.count({ where: { contactId: winnerId } }),
        prisma.lifeEvent.count({ where: { contactId: winnerId } }),
        prisma.idea.count({ where: { contactId: winnerId } }),
        prisma.task.count({ where: { contactId: winnerId } }),
        prisma.plan.count({ where: { contactId: winnerId } }),
        prisma.contactTag.count({ where: { contactId: winnerId } }),
        prisma.householdMember.count({ where: { contactId: winnerId } }),
        prisma.associate.count({ where: { contactId: winnerId } }),
        prisma.interactionParticipant.count({ where: { contactId: winnerId } }),
        prisma.interactionMention.count({ where: { contactId: winnerId } }),
        prisma.lifeEventParticipant.count({ where: { contactId: winnerId } }),
        prisma.relationship.count({ where: { fromContactId: winnerId } }),
        prisma.romanticProfile.count({ where: { contactId: winnerId } }),
        prisma.customFieldValue.count({ where: { entityId: winnerId } }),
      ]);
      expect(counts.every((n) => n === 1), `moved: ${counts.join(",")}`).toBe(true);

      expect(await prisma.contact.count({ where: { id: loserId } })).toBe(0);
    });
  });

  describe("constraints that a straight repoint would violate", () => {
    it("keeps one tag when both carried it", async () => {
      const tag = await prisma.tag.create({ data: { ownerId, name: "T", slug: "t" } });
      await prisma.contactTag.createMany({
        data: [
          { ownerId, contactId: winnerId, tagId: tag.id },
          { ownerId, contactId: loserId, tagId: tag.id },
        ],
      });

      expect((await merge()).ok).toBe(true);
      expect(await prisma.contactTag.count({ where: { contactId: winnerId } })).toBe(1);
    });

    it("collapses an interaction that named both to a single participant", async () => {
      const interaction = await prisma.interaction.create({
        data: { ownerId, title: "Dinner", occurredAt: new Date("2026-01-02T10:00:00Z") },
      });
      await prisma.interactionParticipant.createMany({
        data: [
          { ownerId, contactId: winnerId, interactionId: interaction.id },
          { ownerId, contactId: loserId, interactionId: interaction.id },
        ],
      });

      expect((await merge()).ok).toBe(true);
      expect(
        await prisma.interactionParticipant.count({ where: { interactionId: interaction.id } }),
      ).toBe(1);
    });

    it("keeps one membership when both were in the same household", async () => {
      const household = await prisma.household.create({ data: { ownerId, name: "H" } });
      await prisma.householdMember.createMany({
        data: [
          { ownerId, contactId: winnerId, householdId: household.id },
          { ownerId, contactId: loserId, householdId: household.id },
        ],
      });

      expect((await merge()).ok).toBe(true);
      expect(await prisma.householdMember.count({ where: { householdId: household.id } })).toBe(1);
    });

    it("drops a relationship between the two, which is now a person related to themselves", async () => {
      const relType = await prisma.taxonomyTerm.findFirstOrThrow({
        where: { ownerId, kind: "RELATIONSHIP_TYPE" },
      });
      await prisma.relationship.create({
        data: {
          ownerId,
          fromContactId: winnerId,
          toContactId: loserId,
          typeId: relType.id,
          pairId: "self",
        },
      });

      expect((await merge()).ok).toBe(true);
      expect(await prisma.relationship.count()).toBe(0);
    });

    it("keeps the survivor's answer to a field both had answered", async () => {
      const definition = await prisma.customFieldDefinition.create({
        data: { ownerId, entity: "CONTACT", key: "k", label: "K", fieldType: "TEXT" },
      });
      await prisma.customFieldValue.createMany({
        data: [
          { ownerId, definitionId: definition.id, entityType: "CONTACT", entityId: winnerId, value: "keep" },
          { ownerId, definitionId: definition.id, entityType: "CONTACT", entityId: loserId, value: "drop" },
        ],
      });

      expect((await merge()).ok).toBe(true);
      const values = await prisma.customFieldValue.findMany({ where: { entityId: winnerId } });
      expect(values).toHaveLength(1);
      expect(values[0]!.value).toBe("keep");
    });
  });

  describe("what it refuses", () => {
    it("refuses to merge a contact into itself", async () => {
      const result = await prisma.$transaction((tx) =>
        mergeContacts(tx, ownerId, { winnerId, loserId: winnerId, fields: {} }, {}),
      );
      expect(result.refusal).toBe("same-contact");
    });

    it("refuses when both carry a romantic profile, rather than dropping one", async () => {
      // A profile is a whole record, not a field. Silently discarding one would
      // be the largest thing this could destroy without saying so.
      await prisma.romanticProfile.createMany({
        data: [
          { ownerId, contactId: winnerId },
          { ownerId, contactId: loserId },
        ],
      });

      const result = await merge();
      expect(result.refusal).toBe("both-romantic");
      expect(await prisma.contact.count({ where: { id: loserId } })).toBe(1);
    });

    it("refuses another account's contact", async () => {
      const other = await createTestUser();
      const theirs = await prisma.contact.create({
        data: { ownerId: other.id, firstName: "Theirs" },
      });
      const result = await prisma.$transaction((tx) =>
        mergeContacts(tx, ownerId, { winnerId, loserId: theirs.id, fields: {} }, {}),
      );
      expect(result.refusal).toBe("not-found");
      expect(await prisma.contact.count({ where: { id: theirs.id } })).toBe(1);
    });

    it("refuses a contact the privacy scope is hiding", async () => {
      // Merging into something you cannot see would let a closed lock be used
      // to fold a private person into a public one without showing you either.
      await prisma.contact.update({ where: { id: loserId }, data: { isPrivate: true } });
      const result = await prisma.$transaction((tx) =>
        mergeContacts(tx, ownerId, { winnerId, loserId, fields: {} }, { isPrivate: false }),
      );
      expect(result.refusal).toBe("not-found");
      expect(await prisma.contact.count({ where: { id: loserId } })).toBe(1);
    });
  });

  describe("the survivor", () => {
    it("takes the chosen values", async () => {
      await prisma.contact.update({
        where: { id: loserId },
        data: { occupation: "Baker", city: "Leeds" },
      });

      expect((await merge({ firstName: "Chosen", occupation: "Baker" })).ok).toBe(true);
      const survivor = await prisma.contact.findUniqueOrThrow({ where: { id: winnerId } });
      expect(survivor.firstName).toBe("Chosen");
      expect(survivor.occupation).toBe("Baker");
    });

    it("stays private if either side was", async () => {
      // Never a choice: folding a private person into a public record would
      // publish everything they carried.
      await prisma.contact.update({ where: { id: loserId }, data: { isPrivate: true } });
      expect((await merge()).ok).toBe(true);
      const survivor = await prisma.contact.findUniqueOrThrow({ where: { id: winnerId } });
      expect(survivor.isPrivate).toBe(true);
    });

    it("recomputes its cadence from both histories, never assigns it", async () => {
      // Invariant 1. The loser's interaction is older; after the merge the
      // survivor's last contact is the newer of the two, computed from the
      // rows rather than copied from either record.
      await prisma.contact.update({ where: { id: winnerId }, data: { cadenceDays: 30 } });
      for (const [contactId, when] of [
        [winnerId, "2026-01-01T10:00:00Z"],
        [loserId, "2026-06-01T10:00:00Z"],
      ] as const) {
        const interaction = await prisma.interaction.create({
          data: { ownerId, title: "Met", occurredAt: new Date(when) },
        });
        await prisma.interactionParticipant.create({
          data: { ownerId, contactId, interactionId: interaction.id },
        });
      }

      expect((await merge()).ok).toBe(true);
      const survivor = await prisma.contact.findUniqueOrThrow({ where: { id: winnerId } });
      expect(survivor.lastInteractionAt?.toISOString()).toBe("2026-06-01T10:00:00.000Z");
    });
  });

  describe("the guard against forgetting one", () => {
    it("handles every table in the schema that carries a contact key", () => {
      // The failure this whole file exists for is a relation nobody remembered.
      // Adding one to the schema fails here until the merge service names it,
      // which is the only way a future table cannot be quietly cascaded away.
      const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
      const service = readFileSync(
        join(process.cwd(), "src/server/services/contact-merge.ts"),
        "utf8",
      );

      const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
        .filter(([, , body]) => /^\s+\w*[Cc]ontactId\s+String/m.test(body!))
        .map(([, name]) => name!)
        .filter((name) => name !== "Contact");

      const missing = models.filter((name) => {
        const delegate = name.charAt(0).toLowerCase() + name.slice(1);
        return !service.includes(`"${delegate}"`) && !service.includes(`.${delegate}.`);
      });

      expect(missing, `not handled by contact-merge.ts: ${missing.join(", ")}`).toEqual([]);
    });
  });
});
