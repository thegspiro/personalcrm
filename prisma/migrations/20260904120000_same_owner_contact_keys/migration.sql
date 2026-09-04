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

-- --- the keys the composite foreign keys point at -------------------------
ALTER TABLE `Interaction` ADD UNIQUE INDEX `Interaction_ownerId_id_key` (`ownerId`, `id`);
ALTER TABLE `LifeEvent`   ADD UNIQUE INDEX `LifeEvent_ownerId_id_key` (`ownerId`, `id`);
ALTER TABLE `Household`   ADD UNIQUE INDEX `Household_ownerId_id_key` (`ownerId`, `id`);

-- --- custom field values for records this repair removes --------------------
-- `CustomFieldValue.entityId` points at four different tables and is therefore
-- not a foreign key, so nothing cascades and every delete path sweeps it by
-- hand. This is a delete path. `ROMANTIC` values are keyed by the contact id
-- and `DATE_ENTRY` values by the entry id, matching
-- `deleteCustomFieldValues` in src/server/actions. Left behind they would keep
-- counting toward the custom-field totals and keep appearing in exports, for
-- records that no longer exist.
SET @xoCustomFields = (
  SELECT COUNT(*) FROM `CustomFieldValue` `v`
    JOIN `RomanticProfile` `x` ON `x`.`ownerId` = `v`.`ownerId` AND `x`.`contactId` = `v`.`entityId`
    JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
    WHERE `v`.`entityType` = 'ROMANTIC' AND `c`.`ownerId` <> `x`.`ownerId`
) + (
  SELECT COUNT(*) FROM `CustomFieldValue` `v`
    JOIN `DateEntry` `x` ON `x`.`ownerId` = `v`.`ownerId` AND `x`.`id` = `v`.`entityId`
    JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
    WHERE `v`.`entityType` = 'DATE_ENTRY' AND `c`.`ownerId` <> `x`.`ownerId`
);

DELETE `v` FROM `CustomFieldValue` `v`
  JOIN `RomanticProfile` `x` ON `x`.`ownerId` = `v`.`ownerId` AND `x`.`contactId` = `v`.`entityId`
  JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
  WHERE `v`.`entityType` = 'ROMANTIC' AND `c`.`ownerId` <> `x`.`ownerId`;

DELETE `v` FROM `CustomFieldValue` `v`
  JOIN `DateEntry` `x` ON `x`.`ownerId` = `v`.`ownerId` AND `x`.`id` = `v`.`entityId`
  JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
  WHERE `v`.`entityType` = 'DATE_ENTRY' AND `c`.`ownerId` <> `x`.`ownerId`;

-- --- required links: count, then delete ------------------------------------
SET @xoRelationships = (
  SELECT COUNT(*) FROM `Relationship` `r`
    JOIN `Contact` `f` ON `f`.`id` = `r`.`fromContactId`
    JOIN `Contact` `t` ON `t`.`id` = `r`.`toContactId`
    WHERE `f`.`ownerId` <> `r`.`ownerId` OR `t`.`ownerId` <> `r`.`ownerId`
);
DELETE `r` FROM `Relationship` `r`
  JOIN `Contact` `f` ON `f`.`id` = `r`.`fromContactId`
  JOIN `Contact` `t` ON `t`.`id` = `r`.`toContactId`
  WHERE `f`.`ownerId` <> `r`.`ownerId` OR `t`.`ownerId` <> `r`.`ownerId`;

SET @xoFacts = (
  SELECT COUNT(*) FROM `Fact` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
    WHERE `c`.`ownerId` <> `x`.`ownerId`
);
DELETE `x` FROM `Fact` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
  WHERE `c`.`ownerId` <> `x`.`ownerId`;

SET @xoImportantDates = (
  SELECT COUNT(*) FROM `ImportantDate` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
    WHERE `c`.`ownerId` <> `x`.`ownerId`
);
DELETE `x` FROM `ImportantDate` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
  WHERE `c`.`ownerId` <> `x`.`ownerId`;

SET @xoLifeEvents = (
  SELECT COUNT(*) FROM `LifeEvent` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
    WHERE `c`.`ownerId` <> `x`.`ownerId`
);
DELETE `x` FROM `LifeEvent` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
  WHERE `c`.`ownerId` <> `x`.`ownerId`;

SET @xoDismissals = (
  SELECT COUNT(*) FROM `FamilySuggestionDismissal` `d`
    JOIN `Contact` `a` ON `a`.`id` = `d`.`aContactId`
    JOIN `Contact` `b` ON `b`.`id` = `d`.`bContactId`
    WHERE `a`.`ownerId` <> `d`.`ownerId` OR `b`.`ownerId` <> `d`.`ownerId`
);
DELETE `d` FROM `FamilySuggestionDismissal` `d`
  JOIN `Contact` `a` ON `a`.`id` = `d`.`aContactId`
  JOIN `Contact` `b` ON `b`.`id` = `d`.`bContactId`
  WHERE `a`.`ownerId` <> `d`.`ownerId` OR `b`.`ownerId` <> `d`.`ownerId`;

SET @xoHappenings = (
  SELECT COUNT(*) FROM `Happening` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
    WHERE `c`.`ownerId` <> `x`.`ownerId`
);
DELETE `x` FROM `Happening` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
  WHERE `c`.`ownerId` <> `x`.`ownerId`;

SET @xoGifts = (
  SELECT COUNT(*) FROM `Gift` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
    WHERE `c`.`ownerId` <> `x`.`ownerId`
);
DELETE `x` FROM `Gift` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
  WHERE `c`.`ownerId` <> `x`.`ownerId`;

SET @xoDebts = (
  SELECT COUNT(*) FROM `Debt` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
    WHERE `c`.`ownerId` <> `x`.`ownerId`
);
DELETE `x` FROM `Debt` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
  WHERE `c`.`ownerId` <> `x`.`ownerId`;

SET @xoDietaryNeeds = (
  SELECT COUNT(*) FROM `DietaryNeed` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
    WHERE `c`.`ownerId` <> `x`.`ownerId`
);
DELETE `x` FROM `DietaryNeed` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
  WHERE `c`.`ownerId` <> `x`.`ownerId`;

SET @xoRomanticProfiles = (
  SELECT COUNT(*) FROM `RomanticProfile` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
    WHERE `c`.`ownerId` <> `x`.`ownerId`
);
DELETE `x` FROM `RomanticProfile` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
  WHERE `c`.`ownerId` <> `x`.`ownerId`;

SET @xoDateEntries = (
  SELECT COUNT(*) FROM `DateEntry` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
    WHERE `c`.`ownerId` <> `x`.`ownerId`
);
DELETE `x` FROM `DateEntry` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
  WHERE `c`.`ownerId` <> `x`.`ownerId`;

SET @xoFlags = (
  SELECT COUNT(*) FROM `Flag` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
    WHERE `c`.`ownerId` <> `x`.`ownerId`
);
DELETE `x` FROM `Flag` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
  WHERE `c`.`ownerId` <> `x`.`ownerId`;

-- --- optional links: count, then detach ------------------------------------
SET @xoIdeas = (
  SELECT COUNT(*) FROM `Idea` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
    WHERE `c`.`ownerId` <> `x`.`ownerId`
);
UPDATE `Idea` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
  SET `x`.`contactId` = NULL
  WHERE `c`.`ownerId` <> `x`.`ownerId`;

SET @xoTasks = (
  SELECT COUNT(*) FROM `Task` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
    WHERE `c`.`ownerId` <> `x`.`ownerId`
);
UPDATE `Task` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
  SET `x`.`contactId` = NULL
  WHERE `c`.`ownerId` <> `x`.`ownerId`;

SET @xoPlans = (
  SELECT COUNT(*) FROM `Plan` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
    WHERE `c`.`ownerId` <> `x`.`ownerId`
);
UPDATE `Plan` `x` JOIN `Contact` `c` ON `c`.`id` = `x`.`contactId`
  SET `x`.`contactId` = NULL
  WHERE `c`.`ownerId` <> `x`.`ownerId`;

-- --- the two place links that cannot take a composite key -------------------
-- `SET NULL` needs every column of the key nullable and `ownerId` is not, so
-- these keep a single-column key and an explicit predicate in the readers.
-- Detaching what is already mismatched is still worth doing: it is exactly the
-- row those predicates exist to survive, and nothing is lost but a pointer at
-- a place this account cannot see.
SET @xoInteractionPlaces = (
  SELECT COUNT(*) FROM `Interaction` `x` JOIN `Location` `l` ON `l`.`id` = `x`.`locationId`
    WHERE `l`.`ownerId` <> `x`.`ownerId`
);
UPDATE `Interaction` `x` JOIN `Location` `l` ON `l`.`id` = `x`.`locationId`
  SET `x`.`locationId` = NULL
  WHERE `l`.`ownerId` <> `x`.`ownerId`;

SET @xoPlanPlaces = (
  SELECT COUNT(*) FROM `Plan` `x` JOIN `Location` `l` ON `l`.`id` = `x`.`locationId`
    WHERE `l`.`ownerId` <> `x`.`ownerId`
);
UPDATE `Plan` `x` JOIN `Location` `l` ON `l`.`id` = `x`.`locationId`
  SET `x`.`locationId` = NULL
  WHERE `l`.`ownerId` <> `x`.`ownerId`;

-- --- the join tables: give them an owner, then key on it --------------------
-- Nullable first, because there is nothing to put in it yet; the parent
-- supplies it. `LifeEventParticipant` is backfilled after the `LifeEvent`
-- repair above, so a row cascaded away with its event is never counted here.

ALTER TABLE `InteractionParticipant` ADD COLUMN `ownerId` VARCHAR(191) NULL;
UPDATE `InteractionParticipant` `j` JOIN `Interaction` `p` ON `p`.`id` = `j`.`interactionId`
  SET `j`.`ownerId` = `p`.`ownerId`;
SET @xoParticipants = (
  SELECT COUNT(*) FROM `InteractionParticipant` `j` JOIN `Contact` `c` ON `c`.`id` = `j`.`contactId`
    WHERE `c`.`ownerId` <> `j`.`ownerId`
);
DELETE `j` FROM `InteractionParticipant` `j` JOIN `Contact` `c` ON `c`.`id` = `j`.`contactId`
  WHERE `c`.`ownerId` <> `j`.`ownerId`;
ALTER TABLE `InteractionParticipant` MODIFY COLUMN `ownerId` VARCHAR(191) NOT NULL;

ALTER TABLE `InteractionMention` ADD COLUMN `ownerId` VARCHAR(191) NULL;
UPDATE `InteractionMention` `j` JOIN `Interaction` `p` ON `p`.`id` = `j`.`interactionId`
  SET `j`.`ownerId` = `p`.`ownerId`;
SET @xoMentions = (
  SELECT COUNT(*) FROM `InteractionMention` `j` JOIN `Contact` `c` ON `c`.`id` = `j`.`contactId`
    WHERE `c`.`ownerId` <> `j`.`ownerId`
);
DELETE `j` FROM `InteractionMention` `j` JOIN `Contact` `c` ON `c`.`id` = `j`.`contactId`
  WHERE `c`.`ownerId` <> `j`.`ownerId`;
ALTER TABLE `InteractionMention` MODIFY COLUMN `ownerId` VARCHAR(191) NOT NULL;

ALTER TABLE `LifeEventParticipant` ADD COLUMN `ownerId` VARCHAR(191) NULL;
UPDATE `LifeEventParticipant` `j` JOIN `LifeEvent` `p` ON `p`.`id` = `j`.`lifeEventId`
  SET `j`.`ownerId` = `p`.`ownerId`;
SET @xoEventParticipants = (
  SELECT COUNT(*) FROM `LifeEventParticipant` `j` JOIN `Contact` `c` ON `c`.`id` = `j`.`contactId`
    WHERE `c`.`ownerId` <> `j`.`ownerId`
);
DELETE `j` FROM `LifeEventParticipant` `j` JOIN `Contact` `c` ON `c`.`id` = `j`.`contactId`
  WHERE `c`.`ownerId` <> `j`.`ownerId`;
ALTER TABLE `LifeEventParticipant` MODIFY COLUMN `ownerId` VARCHAR(191) NOT NULL;

ALTER TABLE `HouseholdMember` ADD COLUMN `ownerId` VARCHAR(191) NULL;
UPDATE `HouseholdMember` `j` JOIN `Household` `p` ON `p`.`id` = `j`.`householdId`
  SET `j`.`ownerId` = `p`.`ownerId`;
SET @xoHouseholdMembers = (
  SELECT COUNT(*) FROM `HouseholdMember` `j` JOIN `Contact` `c` ON `c`.`id` = `j`.`contactId`
    WHERE `c`.`ownerId` <> `j`.`ownerId`
);
DELETE `j` FROM `HouseholdMember` `j` JOIN `Contact` `c` ON `c`.`id` = `j`.`contactId`
  WHERE `c`.`ownerId` <> `j`.`ownerId`;
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

-- --- what was repaired -----------------------------------------------------
-- Left where `runStartupTasks` can find it, and only when there was something
-- to say, so a healthy installation stays quiet.
SET @xoDeleted = @xoRelationships + @xoFacts + @xoImportantDates + @xoLifeEvents
  + @xoDismissals + @xoHappenings + @xoGifts + @xoDebts + @xoDietaryNeeds
  + @xoRomanticProfiles + @xoDateEntries + @xoFlags
  + @xoParticipants + @xoMentions + @xoEventParticipants + @xoHouseholdMembers
  + @xoCustomFields;
SET @xoDetached = @xoIdeas + @xoTasks + @xoPlans
  + @xoInteractionPlaces + @xoPlanPlaces;

-- `CAST(... AS UNSIGNED)` because a user variable read back through the
-- prepared-statement protocol arrives as a string, and `JSON_OBJECT` would then
-- store `"12"` rather than `12`. The reader copes with either, but a count that
-- is a count in one client and a string in another is a trap for the next
-- person to add a key here.
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
