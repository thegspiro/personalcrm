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
-- `Interaction.place` and `Plan.place` are deliberately not converted. They are
-- `ON DELETE SET NULL`, and MariaDB refuses a SET NULL foreign key unless every
-- column in it is nullable — `ownerId` is not. Their owner predicates stay in
-- `src/server/services/locations.ts`.

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

-- --- what was repaired -----------------------------------------------------
-- Left where `runStartupTasks` can find it, and only when there was something
-- to say, so a healthy installation stays quiet.
SET @xoDeleted = @xoRelationships + @xoFacts + @xoImportantDates + @xoLifeEvents
  + @xoDismissals + @xoHappenings + @xoGifts + @xoDebts + @xoDietaryNeeds
  + @xoRomanticProfiles + @xoDateEntries + @xoFlags;
SET @xoDetached = @xoIdeas + @xoTasks + @xoPlans;

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
