-- Extend the same-owner key to every table that points at a `Contact`.
--
-- `20260903140000_same_owner_join_keys` did this for the two join tables and
-- left the seventeen owned relations alone. Those carry the same shape: an
-- `ownerId` that says who the row belongs to, and a `contactId` that says
-- nothing about it, so a restore or a hand repair can leave one account's note,
-- gift or dating profile hanging off another account's person. Referencing
-- `Contact(ownerId, id)` makes the two owners literally the same column, and
-- the predicate every read had to remember becomes something the database
-- refuses to store.
--
-- The order matters: remove what cannot satisfy the constraint, then add it.
-- Adding it first aborts the upgrade on exactly the installation that needs the
-- repair.
--
-- Two repairs, because the tables are not alike. Where `contactId` is NOT NULL
-- the row cannot exist without the link, so the row goes. Where it is nullable
-- — an idea, a task, a plan — the link goes and the row stays: the owner wrote
-- that text, and deleting their note because a stale row pointed at the wrong
-- person destroys their work to fix ours.
--
-- The four join tables that carried no `ownerId` of their own —
-- `InteractionParticipant`, `InteractionMention`, `LifeEventParticipant` and
-- `HouseholdMember` — gain one, backfilled from their parent, so both of their
-- keys can name it. That is the `ContactTag` treatment, for the same reason:
-- two independent keys let an import file one account's interaction against
-- another account's person, and the dashboard joins straight through them.
--
-- `Interaction.place` and `Plan.place` are the only references that keep a
-- single-column key. They are `ON DELETE SET NULL`, and MariaDB refuses a SET
-- NULL foreign key unless every column in it is nullable — `ownerId` is not.
-- Existing mismatches are detached here and the readers keep an explicit owner
-- predicate: `src/server/services/locations.ts` for the write path and
-- `src/server/queries/timeline.ts` for the read.
--
-- Every repair below asks the constraint's own question — "is there a `Contact`
-- with this owner and this id" — rather than "do the two owners disagree". A
-- restore with foreign-key checks off is the scenario this migration exists
-- for, and it can leave a `contactId` pointing at nothing at all. That row
-- fails the new key exactly as a mismatched one does, a join between the two
-- tables skips it, and the upgrade would then abort on the installation that
-- needed the repair most.

-- --- the keys the composite foreign keys point at -------------------------
ALTER TABLE `Interaction` ADD UNIQUE INDEX `Interaction_ownerId_id_key` (`ownerId`, `id`);
ALTER TABLE `LifeEvent`   ADD UNIQUE INDEX `LifeEvent_ownerId_id_key` (`ownerId`, `id`);
ALTER TABLE `Household`   ADD UNIQUE INDEX `Household_ownerId_id_key` (`ownerId`, `id`);

-- --- custom field values for records this repair removes --------------------
-- `CustomFieldValue.entityId` points at four different tables and is therefore
-- not a foreign key, so nothing cascades and every delete path sweeps it by
-- hand. This is a delete path. `ROMANTIC` values are keyed by the contact id
-- and `DATE_ENTRY` values by the entry id, matching `deleteCustomFieldValues`
-- in src/server/actions. Left behind they would keep counting toward the
-- custom-field totals and keep appearing in exports, for records that no
-- longer exist.
SET @xoCustomFields = (
  SELECT COUNT(*) FROM `CustomFieldValue` `v`
    JOIN `RomanticProfile` `x` ON `x`.`ownerId` = `v`.`ownerId` AND `x`.`contactId` = `v`.`entityId`
    WHERE `v`.`entityType` = 'ROMANTIC' AND NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
) + (
  SELECT COUNT(*) FROM `CustomFieldValue` `v`
    JOIN `DateEntry` `x` ON `x`.`ownerId` = `v`.`ownerId` AND `x`.`id` = `v`.`entityId`
    WHERE `v`.`entityType` = 'DATE_ENTRY' AND NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
);

DELETE `v` FROM `CustomFieldValue` `v`
  JOIN `RomanticProfile` `x` ON `x`.`ownerId` = `v`.`ownerId` AND `x`.`contactId` = `v`.`entityId`
  WHERE `v`.`entityType` = 'ROMANTIC' AND NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  );

DELETE `v` FROM `CustomFieldValue` `v`
  JOIN `DateEntry` `x` ON `x`.`ownerId` = `v`.`ownerId` AND `x`.`id` = `v`.`entityId`
  WHERE `v`.`entityType` = 'DATE_ENTRY' AND NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  );

-- --- required links: count, then delete ------------------------------------
-- The condition is the constraint's own, not "the owners disagree": a
-- `contactId` matching no row at all fails the new key exactly as a mismatched
-- one does, and a restore with foreign-key checks off — the same recovery this
-- repair exists for — can leave one behind. Written as a join between the two
-- tables it would be skipped, and `ADD CONSTRAINT` would then abort the
-- upgrade on the installation that needed the repair most.
-- A relationship is two directional rows sharing a `pairId`: "Alice is Bob's
-- parent" and "Bob is Alice's child". Every write path treats the pair as the
-- unit — `deleteRelationship` removes `WHERE ownerId, pairId` — so removing the
-- one direction that fails the key would leave the other standing, and the two
-- people would show contradictory relationships until somebody edited one. The
-- pair is what goes. The derived table is not decoration: MariaDB refuses a
-- subquery that reads the table being deleted from unless it is materialised.
SET @xoRelationships = (
  SELECT COUNT(*) FROM `Relationship` `r` WHERE `r`.`pairId` IN (
    SELECT `pairId` FROM (
      SELECT DISTINCT `x`.`pairId` FROM `Relationship` `x`
        WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`fromContactId`
  ) OR NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`toContactId`
  )
    ) AS `broken`
  )
);
DELETE `r` FROM `Relationship` `r` WHERE `r`.`pairId` IN (
  SELECT `pairId` FROM (
    SELECT DISTINCT `x`.`pairId` FROM `Relationship` `x`
      WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`fromContactId`
  ) OR NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`toContactId`
  )
  ) AS `broken`
);
SET @xoFacts = (
  SELECT COUNT(*) FROM `Fact` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
);
DELETE `x` FROM `Fact` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  );
SET @xoImportantDates = (
  SELECT COUNT(*) FROM `ImportantDate` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
);
DELETE `x` FROM `ImportantDate` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  );
SET @xoLifeEvents = (
  SELECT COUNT(*) FROM `LifeEvent` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
);
DELETE `x` FROM `LifeEvent` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  );
SET @xoDismissals = (
  SELECT COUNT(*) FROM `FamilySuggestionDismissal` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`aContactId`
  ) OR NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`bContactId`
  )
);
DELETE `x` FROM `FamilySuggestionDismissal` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`aContactId`
  ) OR NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`bContactId`
  );
-- The follow-up is an ordinary `Task`, and the key points from the happening
-- to it — so nothing cascades this way and `deleteHappening` removes it by
-- hand. Left behind, "Ask how the trip went" stays on the tasks page and in the
-- digest for an event that no longer exists. Mirrors `deleteFollowUpTask`: only
-- while it is still open, because a completed one is history.
SET @xoFollowUpTasks = (
  SELECT COUNT(*) FROM `Task` `t`
    JOIN `Happening` `x` ON `x`.`followUpTaskId` = `t`.`id` AND `x`.`ownerId` = `t`.`ownerId`
    WHERE `t`.`completedAt` IS NULL AND NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
);
DELETE `t` FROM `Task` `t`
  JOIN `Happening` `x` ON `x`.`followUpTaskId` = `t`.`id` AND `x`.`ownerId` = `t`.`ownerId`
  WHERE `t`.`completedAt` IS NULL AND NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  );

SET @xoHappenings = (
  SELECT COUNT(*) FROM `Happening` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
);
DELETE `x` FROM `Happening` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  );
SET @xoGifts = (
  SELECT COUNT(*) FROM `Gift` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
);
DELETE `x` FROM `Gift` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  );
SET @xoDebts = (
  SELECT COUNT(*) FROM `Debt` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
);
DELETE `x` FROM `Debt` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  );
SET @xoDietaryNeeds = (
  SELECT COUNT(*) FROM `DietaryNeed` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
);
DELETE `x` FROM `DietaryNeed` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  );
SET @xoRomanticProfiles = (
  SELECT COUNT(*) FROM `RomanticProfile` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
);
DELETE `x` FROM `RomanticProfile` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  );
-- `sequence` is "the nth date with this person", maintained on write, and the
-- normal delete path calls `resequenceDateEntries`. A migration cannot: the
-- ordering is derived in application code. The contacts whose numbering this
-- disturbs are recorded instead, and `runStartupTasks` runs the real service
-- over them at the next boot.
SET @xoResequence = IFNULL((
  SELECT JSON_ARRAYAGG(`id`) FROM (
    SELECT DISTINCT `x`.`contactId` AS `id` FROM `DateEntry` `x`
      WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
        AND EXISTS (SELECT 1 FROM `Contact` `c2` WHERE `c2`.`id` = `x`.`contactId`)
  ) AS `touched`
), JSON_ARRAY());

SET @xoDateEntries = (
  SELECT COUNT(*) FROM `DateEntry` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
);
DELETE `x` FROM `DateEntry` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  );
SET @xoFlags = (
  SELECT COUNT(*) FROM `Flag` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
);
DELETE `x` FROM `Flag` `x` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  );

-- --- optional links: count, then detach ------------------------------------
-- The row is the owner's own writing; only the pointer is wrong.
SET @xoIdeas = (
  SELECT COUNT(*) FROM `Idea` `x` WHERE `x`.`contactId` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
);
UPDATE `Idea` `x` SET `x`.`contactId` = NULL
  WHERE `x`.`contactId` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  );
SET @xoTasks = (
  SELECT COUNT(*) FROM `Task` `x` WHERE `x`.`contactId` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
);
UPDATE `Task` `x` SET `x`.`contactId` = NULL
  WHERE `x`.`contactId` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  );
SET @xoPlans = (
  SELECT COUNT(*) FROM `Plan` `x` WHERE `x`.`contactId` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  )
);
UPDATE `Plan` `x` SET `x`.`contactId` = NULL
  WHERE `x`.`contactId` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `x`.`ownerId` AND `c`.`id` = `x`.`contactId`
  );

-- --- the two place links that cannot take a composite key -------------------
-- `SET NULL` needs every column of the key nullable and `ownerId` is not, so
-- these keep a single-column key and an explicit predicate in the readers.
-- Detaching what is already broken is still worth doing: it is exactly the row
-- those predicates exist to survive, and nothing is lost but a pointer at a
-- place this account cannot see, or at no place at all.
SET @xoInteractionPlaces = (
  SELECT COUNT(*) FROM `Interaction` `x` WHERE `x`.`locationId` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `Location` `l`
      WHERE `l`.`ownerId` = `x`.`ownerId` AND `l`.`id` = `x`.`locationId`
  )
);
UPDATE `Interaction` `x` SET `x`.`locationId` = NULL
  WHERE `x`.`locationId` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `Location` `l`
      WHERE `l`.`ownerId` = `x`.`ownerId` AND `l`.`id` = `x`.`locationId`
  );
SET @xoPlanPlaces = (
  SELECT COUNT(*) FROM `Plan` `x` WHERE `x`.`locationId` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `Location` `l`
      WHERE `l`.`ownerId` = `x`.`ownerId` AND `l`.`id` = `x`.`locationId`
  )
);
UPDATE `Plan` `x` SET `x`.`locationId` = NULL
  WHERE `x`.`locationId` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `Location` `l`
      WHERE `l`.`ownerId` = `x`.`ownerId` AND `l`.`id` = `x`.`locationId`
  );

-- --- the join tables: give them an owner, then key on it --------------------
-- Rows whose parent is gone go first: the owner is copied from that parent, so
-- without this the column stays NULL and `MODIFY ... NOT NULL` refuses. Then
-- the same constraint-shaped condition as above removes what the contact key
-- would refuse. `LifeEventParticipant` is reached after the `LifeEvent` repair,
-- so a row cascaded away with its event is never counted here.
-- Removing a participant removes a history edge, and `lastInteractionAt` /
-- `nextTouchAt` are derived from the full history by `contact-activity.ts` —
-- the one place allowed to write them. Left stale, the referenced person keeps
-- a last-contact date from a meeting they are no longer part of, and drops off
-- the overdue list on the strength of it. The contacts are recorded here and
-- recomputed by the real service at the next boot. Captured before either
-- delete, and only for contacts that exist: a dangling id has nothing to
-- recompute.
SET @xoRecompute = IFNULL((
  SELECT JSON_ARRAYAGG(`id`) FROM (
    SELECT DISTINCT `j`.`contactId` AS `id` FROM `InteractionParticipant` `j`
      WHERE EXISTS (SELECT 1 FROM `Contact` `c2` WHERE `c2`.`id` = `j`.`contactId`)
        AND (
          NOT EXISTS (SELECT 1 FROM `Interaction` `p` WHERE `p`.`id` = `j`.`interactionId`)
          OR NOT EXISTS (
            SELECT 1 FROM `Contact` `c`
              WHERE `c`.`ownerId` = (
                SELECT `p2`.`ownerId` FROM `Interaction` `p2` WHERE `p2`.`id` = `j`.`interactionId`
              ) AND `c`.`id` = `j`.`contactId`
          )
        )
  ) AS `touched`
), JSON_ARRAY());

SET @xoParticipants = (SELECT COUNT(*) FROM `InteractionParticipant` `j` WHERE NOT EXISTS (
    SELECT 1 FROM `Interaction` `p` WHERE `p`.`id` = `j`.`interactionId`
  ));
DELETE `j` FROM `InteractionParticipant` `j` WHERE NOT EXISTS (
    SELECT 1 FROM `Interaction` `p` WHERE `p`.`id` = `j`.`interactionId`
  );
ALTER TABLE `InteractionParticipant` ADD COLUMN `ownerId` VARCHAR(191) NULL;
UPDATE `InteractionParticipant` `j` JOIN `Interaction` `p` ON `p`.`id` = `j`.`interactionId`
  SET `j`.`ownerId` = `p`.`ownerId`;
SET @xoParticipants = @xoParticipants + (
  SELECT COUNT(*) FROM `InteractionParticipant` `j` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `j`.`ownerId` AND `c`.`id` = `j`.`contactId`
  )
);
DELETE `j` FROM `InteractionParticipant` `j` WHERE NOT EXISTS (
  SELECT 1 FROM `Contact` `c`
    WHERE `c`.`ownerId` = `j`.`ownerId` AND `c`.`id` = `j`.`contactId`
);
ALTER TABLE `InteractionParticipant` MODIFY COLUMN `ownerId` VARCHAR(191) NOT NULL;
SET @xoMentions = (SELECT COUNT(*) FROM `InteractionMention` `j` WHERE NOT EXISTS (
    SELECT 1 FROM `Interaction` `p` WHERE `p`.`id` = `j`.`interactionId`
  ));
DELETE `j` FROM `InteractionMention` `j` WHERE NOT EXISTS (
    SELECT 1 FROM `Interaction` `p` WHERE `p`.`id` = `j`.`interactionId`
  );
ALTER TABLE `InteractionMention` ADD COLUMN `ownerId` VARCHAR(191) NULL;
UPDATE `InteractionMention` `j` JOIN `Interaction` `p` ON `p`.`id` = `j`.`interactionId`
  SET `j`.`ownerId` = `p`.`ownerId`;
SET @xoMentions = @xoMentions + (
  SELECT COUNT(*) FROM `InteractionMention` `j` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `j`.`ownerId` AND `c`.`id` = `j`.`contactId`
  )
);
DELETE `j` FROM `InteractionMention` `j` WHERE NOT EXISTS (
  SELECT 1 FROM `Contact` `c`
    WHERE `c`.`ownerId` = `j`.`ownerId` AND `c`.`id` = `j`.`contactId`
);
ALTER TABLE `InteractionMention` MODIFY COLUMN `ownerId` VARCHAR(191) NOT NULL;
SET @xoEventParticipants = (SELECT COUNT(*) FROM `LifeEventParticipant` `j` WHERE NOT EXISTS (
    SELECT 1 FROM `LifeEvent` `p` WHERE `p`.`id` = `j`.`lifeEventId`
  ));
DELETE `j` FROM `LifeEventParticipant` `j` WHERE NOT EXISTS (
    SELECT 1 FROM `LifeEvent` `p` WHERE `p`.`id` = `j`.`lifeEventId`
  );
ALTER TABLE `LifeEventParticipant` ADD COLUMN `ownerId` VARCHAR(191) NULL;
UPDATE `LifeEventParticipant` `j` JOIN `LifeEvent` `p` ON `p`.`id` = `j`.`lifeEventId`
  SET `j`.`ownerId` = `p`.`ownerId`;
SET @xoEventParticipants = @xoEventParticipants + (
  SELECT COUNT(*) FROM `LifeEventParticipant` `j` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `j`.`ownerId` AND `c`.`id` = `j`.`contactId`
  )
);
DELETE `j` FROM `LifeEventParticipant` `j` WHERE NOT EXISTS (
  SELECT 1 FROM `Contact` `c`
    WHERE `c`.`ownerId` = `j`.`ownerId` AND `c`.`id` = `j`.`contactId`
);
ALTER TABLE `LifeEventParticipant` MODIFY COLUMN `ownerId` VARCHAR(191) NOT NULL;
SET @xoHouseholdMembers = (SELECT COUNT(*) FROM `HouseholdMember` `j` WHERE NOT EXISTS (
    SELECT 1 FROM `Household` `p` WHERE `p`.`id` = `j`.`householdId`
  ));
DELETE `j` FROM `HouseholdMember` `j` WHERE NOT EXISTS (
    SELECT 1 FROM `Household` `p` WHERE `p`.`id` = `j`.`householdId`
  );
ALTER TABLE `HouseholdMember` ADD COLUMN `ownerId` VARCHAR(191) NULL;
UPDATE `HouseholdMember` `j` JOIN `Household` `p` ON `p`.`id` = `j`.`householdId`
  SET `j`.`ownerId` = `p`.`ownerId`;
SET @xoHouseholdMembers = @xoHouseholdMembers + (
  SELECT COUNT(*) FROM `HouseholdMember` `j` WHERE NOT EXISTS (
    SELECT 1 FROM `Contact` `c`
      WHERE `c`.`ownerId` = `j`.`ownerId` AND `c`.`id` = `j`.`contactId`
  )
);
DELETE `j` FROM `HouseholdMember` `j` WHERE NOT EXISTS (
  SELECT 1 FROM `Contact` `c`
    WHERE `c`.`ownerId` = `j`.`ownerId` AND `c`.`id` = `j`.`contactId`
);
ALTER TABLE `HouseholdMember` MODIFY COLUMN `ownerId` VARCHAR(191) NOT NULL;

-- --- swap the keys ---------------------------------------------------------
ALTER TABLE `Relationship` DROP FOREIGN KEY `Relationship_fromContactId_fkey`;
ALTER TABLE `Relationship` DROP FOREIGN KEY `Relationship_toContactId_fkey`;
ALTER TABLE `Relationship` ADD INDEX `Relationship_ownerId_fromContactId_idx` (`ownerId`, `fromContactId`);
ALTER TABLE `Relationship` ADD INDEX `Relationship_ownerId_toContactId_idx` (`ownerId`, `toContactId`);
ALTER TABLE `Relationship`
  ADD CONSTRAINT `Relationship_ownerId_fromContactId_fkey`
  FOREIGN KEY (`ownerId`, `fromContactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Relationship`
  ADD CONSTRAINT `Relationship_ownerId_toContactId_fkey`
  FOREIGN KEY (`ownerId`, `toContactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Fact` DROP FOREIGN KEY `Fact_contactId_fkey`;
ALTER TABLE `Fact` ADD INDEX `Fact_ownerId_contactId_idx` (`ownerId`, `contactId`);
ALTER TABLE `Fact`
  ADD CONSTRAINT `Fact_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ImportantDate` DROP FOREIGN KEY `ImportantDate_contactId_fkey`;
ALTER TABLE `ImportantDate` ADD INDEX `ImportantDate_ownerId_contactId_idx` (`ownerId`, `contactId`);
ALTER TABLE `ImportantDate`
  ADD CONSTRAINT `ImportantDate_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `LifeEvent` DROP FOREIGN KEY `LifeEvent_contactId_fkey`;
ALTER TABLE `LifeEvent` ADD INDEX `LifeEvent_ownerId_contactId_idx` (`ownerId`, `contactId`);
ALTER TABLE `LifeEvent`
  ADD CONSTRAINT `LifeEvent_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `FamilySuggestionDismissal` DROP FOREIGN KEY `FamilySuggestionDismissal_aContactId_fkey`;
ALTER TABLE `FamilySuggestionDismissal` DROP FOREIGN KEY `FamilySuggestionDismissal_bContactId_fkey`;
ALTER TABLE `FamilySuggestionDismissal` ADD INDEX `FamilySuggestionDismissal_ownerId_bContactId_idx` (`ownerId`, `bContactId`);
ALTER TABLE `FamilySuggestionDismissal`
  ADD CONSTRAINT `FamilySuggestionDismissal_ownerId_aContactId_fkey`
  FOREIGN KEY (`ownerId`, `aContactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `FamilySuggestionDismissal`
  ADD CONSTRAINT `FamilySuggestionDismissal_ownerId_bContactId_fkey`
  FOREIGN KEY (`ownerId`, `bContactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Idea` DROP FOREIGN KEY `Idea_contactId_fkey`;
ALTER TABLE `Idea` ADD INDEX `Idea_ownerId_contactId_idx` (`ownerId`, `contactId`);
ALTER TABLE `Idea`
  ADD CONSTRAINT `Idea_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Task` DROP FOREIGN KEY `Task_contactId_fkey`;
ALTER TABLE `Task` ADD INDEX `Task_ownerId_contactId_idx` (`ownerId`, `contactId`);
ALTER TABLE `Task`
  ADD CONSTRAINT `Task_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Happening` DROP FOREIGN KEY `Happening_contactId_fkey`;
ALTER TABLE `Happening` ADD INDEX `Happening_ownerId_contactId_idx` (`ownerId`, `contactId`);
ALTER TABLE `Happening`
  ADD CONSTRAINT `Happening_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Gift` DROP FOREIGN KEY `Gift_contactId_fkey`;
ALTER TABLE `Gift` ADD INDEX `Gift_ownerId_contactId_idx` (`ownerId`, `contactId`);
ALTER TABLE `Gift`
  ADD CONSTRAINT `Gift_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Debt` DROP FOREIGN KEY `Debt_contactId_fkey`;
ALTER TABLE `Debt` ADD INDEX `Debt_ownerId_contactId_idx` (`ownerId`, `contactId`);
ALTER TABLE `Debt`
  ADD CONSTRAINT `Debt_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `DietaryNeed` DROP FOREIGN KEY `DietaryNeed_contactId_fkey`;
ALTER TABLE `DietaryNeed` ADD INDEX `DietaryNeed_ownerId_contactId_idx` (`ownerId`, `contactId`);
ALTER TABLE `DietaryNeed`
  ADD CONSTRAINT `DietaryNeed_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The unique index is what makes `RomanticProfile.contact` a one-to-one on the
-- composite key; `contactId` alone is already unique, so it adds no restriction
-- that was not already in force.
ALTER TABLE `RomanticProfile` DROP FOREIGN KEY `RomanticProfile_contactId_fkey`;
ALTER TABLE `RomanticProfile` ADD UNIQUE INDEX `RomanticProfile_ownerId_contactId_key` (`ownerId`, `contactId`);
ALTER TABLE `RomanticProfile`
  ADD CONSTRAINT `RomanticProfile_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `DateEntry` DROP FOREIGN KEY `DateEntry_contactId_fkey`;
ALTER TABLE `DateEntry` ADD INDEX `DateEntry_ownerId_contactId_idx` (`ownerId`, `contactId`);
ALTER TABLE `DateEntry`
  ADD CONSTRAINT `DateEntry_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Plan` DROP FOREIGN KEY `Plan_contactId_fkey`;
ALTER TABLE `Plan` ADD INDEX `Plan_ownerId_contactId_idx` (`ownerId`, `contactId`);
ALTER TABLE `Plan`
  ADD CONSTRAINT `Plan_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Flag` DROP FOREIGN KEY `Flag_contactId_fkey`;
ALTER TABLE `Flag` ADD INDEX `Flag_ownerId_contactId_idx` (`ownerId`, `contactId`);
ALTER TABLE `Flag`
  ADD CONSTRAINT `Flag_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `InteractionParticipant` DROP FOREIGN KEY `InteractionParticipant_interactionId_fkey`;
ALTER TABLE `InteractionParticipant` DROP FOREIGN KEY `InteractionParticipant_contactId_fkey`;
ALTER TABLE `InteractionParticipant` ADD INDEX `InteractionParticipant_ownerId_interactionId_idx` (`ownerId`, `interactionId`);
ALTER TABLE `InteractionParticipant` ADD INDEX `InteractionParticipant_ownerId_contactId_idx` (`ownerId`, `contactId`);
ALTER TABLE `InteractionParticipant`
  ADD CONSTRAINT `InteractionParticipant_ownerId_interactionId_fkey`
  FOREIGN KEY (`ownerId`, `interactionId`) REFERENCES `Interaction`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `InteractionParticipant`
  ADD CONSTRAINT `InteractionParticipant_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `InteractionMention` DROP FOREIGN KEY `InteractionMention_interactionId_fkey`;
ALTER TABLE `InteractionMention` DROP FOREIGN KEY `InteractionMention_contactId_fkey`;
ALTER TABLE `InteractionMention` ADD INDEX `InteractionMention_ownerId_interactionId_idx` (`ownerId`, `interactionId`);
ALTER TABLE `InteractionMention` ADD INDEX `InteractionMention_ownerId_contactId_idx` (`ownerId`, `contactId`);
ALTER TABLE `InteractionMention`
  ADD CONSTRAINT `InteractionMention_ownerId_interactionId_fkey`
  FOREIGN KEY (`ownerId`, `interactionId`) REFERENCES `Interaction`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `InteractionMention`
  ADD CONSTRAINT `InteractionMention_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `LifeEventParticipant` DROP FOREIGN KEY `LifeEventParticipant_lifeEventId_fkey`;
ALTER TABLE `LifeEventParticipant` DROP FOREIGN KEY `LifeEventParticipant_contactId_fkey`;
ALTER TABLE `LifeEventParticipant` ADD INDEX `LifeEventParticipant_ownerId_lifeEventId_idx` (`ownerId`, `lifeEventId`);
ALTER TABLE `LifeEventParticipant` ADD INDEX `LifeEventParticipant_ownerId_contactId_idx` (`ownerId`, `contactId`);
ALTER TABLE `LifeEventParticipant`
  ADD CONSTRAINT `LifeEventParticipant_ownerId_lifeEventId_fkey`
  FOREIGN KEY (`ownerId`, `lifeEventId`) REFERENCES `LifeEvent`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LifeEventParticipant`
  ADD CONSTRAINT `LifeEventParticipant_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `HouseholdMember` DROP FOREIGN KEY `HouseholdMember_householdId_fkey`;
ALTER TABLE `HouseholdMember` DROP FOREIGN KEY `HouseholdMember_contactId_fkey`;
ALTER TABLE `HouseholdMember` ADD INDEX `HouseholdMember_ownerId_householdId_idx` (`ownerId`, `householdId`);
ALTER TABLE `HouseholdMember` ADD INDEX `HouseholdMember_ownerId_contactId_idx` (`ownerId`, `contactId`);
ALTER TABLE `HouseholdMember`
  ADD CONSTRAINT `HouseholdMember_ownerId_householdId_fkey`
  FOREIGN KEY (`ownerId`, `householdId`) REFERENCES `Household`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `HouseholdMember`
  ADD CONSTRAINT `HouseholdMember_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- --- indexes the new ones have made dead weight -----------------------------
-- `(ownerId)` is the leftmost prefix of the composite index each of these
-- tables just gained, so every lookup it served is served by the wider one and
-- the `ownerId` foreign key stays covered. Dropped rather than left: this
-- change is what made them redundant, and an index nothing can use is still
-- maintained on every insert, update and delete.
ALTER TABLE `Relationship` DROP INDEX `Relationship_ownerId_idx`;
ALTER TABLE `Fact`         DROP INDEX `Fact_ownerId_idx`;
ALTER TABLE `DateEntry`    DROP INDEX `DateEntry_ownerId_idx`;

-- --- what was repaired -----------------------------------------------------
-- Left where `runStartupTasks` can find it, and only when there was something
-- to say, so a healthy installation stays quiet.
SET @xoDeleted = @xoRelationships + @xoFacts + @xoImportantDates + @xoLifeEvents
  + @xoDismissals + @xoHappenings + @xoGifts + @xoDebts + @xoDietaryNeeds
  + @xoRomanticProfiles + @xoDateEntries + @xoFlags
  + @xoParticipants + @xoMentions + @xoEventParticipants + @xoHouseholdMembers
  + @xoCustomFields + @xoFollowUpTasks;
SET @xoDetached = @xoIdeas + @xoTasks + @xoPlans
  + @xoInteractionPlaces + @xoPlanPlaces;

-- `CAST(... AS UNSIGNED)` because a user variable read back through the
-- prepared-statement protocol arrives as a string, and `JSON_OBJECT` would then
-- store `"12"` rather than `12`. The reader copes with either, but a count that
-- is a count in one client and a string in another is a trap for the next
-- person to add a key here.
-- --- what the application has to finish -------------------------------------
-- Two of the fields this repair disturbs are derived in application code and
-- may not be written from here: `Contact.lastInteractionAt` / `nextTouchAt`,
-- and `DateEntry.sequence`. The contacts are left where `runStartupTasks` can
-- find them, and the services that own those fields run over them at the next
-- boot. Written only when there is something to do, so a healthy installation
-- carries no row and does no work.
SET @xoDerived = JSON_MERGE_PRESERVE(@xoRecompute, @xoResequence);

INSERT INTO `AppSetting` (`key`, `value`, `updatedAt`)
  SELECT 'schemaRepair.sameOwnerContactKeys.derived', @xoDerived, NOW(3)
  FROM DUAL
  WHERE JSON_LENGTH(@xoDerived) > 0
  ON DUPLICATE KEY UPDATE `value` = @xoDerived, `updatedAt` = NOW(3);

INSERT INTO `AppSetting` (`key`, `value`, `updatedAt`)
  SELECT 'schemaRepair.sameOwnerContactKeys',
         JSON_OBJECT('deleted', CAST(@xoDeleted AS UNSIGNED),
                     'detached', CAST(@xoDetached AS UNSIGNED)),
         NOW(3)
  FROM DUAL
  WHERE @xoDeleted > 0 OR @xoDetached > 0
  ON DUPLICATE KEY UPDATE
    `value` = JSON_OBJECT('deleted', CAST(@xoDeleted AS UNSIGNED),
                          'detached', CAST(@xoDetached AS UNSIGNED)),
    `updatedAt` = NOW(3);
