-- Make a cross-owner join impossible at the database level.
--
-- `ContactTag` and `LocationAlias` each carry two foreign keys that say nothing
-- about one another, so nothing stopped a row pairing one account's person with
-- another account's tag, or an alias with another account's place. The
-- application never writes one; an import, a restore or a hand repair can, and
-- every read then had to remember a predicate. Referencing `(ownerId, id)` on
-- both sides makes the two owners literally the same column.
--
-- The order matters: backfill, then remove what cannot satisfy the constraint,
-- then add it. Adding it first aborts the upgrade on any installation holding a
-- mismatched row, which is precisely the installation that needs the repair.

-- --- the keys the composite foreign keys point at -------------------------
ALTER TABLE `Contact`  ADD UNIQUE INDEX `Contact_ownerId_id_key` (`ownerId`, `id`);
ALTER TABLE `Tag`      ADD UNIQUE INDEX `Tag_ownerId_id_key` (`ownerId`, `id`);
ALTER TABLE `Location` ADD UNIQUE INDEX `Location_ownerId_id_key` (`ownerId`, `id`);

-- --- ContactTag ------------------------------------------------------------
-- Nullable first, because there is nothing to put in it yet.
ALTER TABLE `ContactTag` ADD COLUMN `ownerId` VARCHAR(191) NULL;

UPDATE `ContactTag` `ct`
  JOIN `Contact` `c` ON `c`.`id` = `ct`.`contactId`
  SET `ct`.`ownerId` = `c`.`ownerId`;

-- Recorded before the delete, so the count survives into the boot log. Rows
-- whose tag belongs to someone else are associations their owner could never
-- see and the application could never have made.
SET @crossOwnerTags = (
  SELECT COUNT(*) FROM `ContactTag` `ct`
    JOIN `Tag` `t` ON `t`.`id` = `ct`.`tagId`
    WHERE `t`.`ownerId` <> `ct`.`ownerId`
);

DELETE `ct` FROM `ContactTag` `ct`
  JOIN `Tag` `t` ON `t`.`id` = `ct`.`tagId`
  WHERE `t`.`ownerId` <> `ct`.`ownerId`;

ALTER TABLE `ContactTag` MODIFY COLUMN `ownerId` VARCHAR(191) NOT NULL;

ALTER TABLE `ContactTag` DROP FOREIGN KEY `ContactTag_contactId_fkey`;
ALTER TABLE `ContactTag` DROP FOREIGN KEY `ContactTag_tagId_fkey`;

ALTER TABLE `ContactTag` ADD INDEX `ContactTag_ownerId_tagId_idx` (`ownerId`, `tagId`);

ALTER TABLE `ContactTag`
  ADD CONSTRAINT `ContactTag_ownerId_contactId_fkey`
  FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ContactTag`
  ADD CONSTRAINT `ContactTag_ownerId_tagId_fkey`
  FOREIGN KEY (`ownerId`, `tagId`) REFERENCES `Tag`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- --- LocationAlias ---------------------------------------------------------
-- It already carries `ownerId`, so only the key it points at changes.
SET @crossOwnerAliases = (
  SELECT COUNT(*) FROM `LocationAlias` `la`
    JOIN `Location` `l` ON `l`.`id` = `la`.`locationId`
    WHERE `l`.`ownerId` <> `la`.`ownerId`
);

DELETE `la` FROM `LocationAlias` `la`
  JOIN `Location` `l` ON `l`.`id` = `la`.`locationId`
  WHERE `l`.`ownerId` <> `la`.`ownerId`;

ALTER TABLE `LocationAlias` DROP FOREIGN KEY `LocationAlias_locationId_fkey`;

ALTER TABLE `LocationAlias` ADD INDEX `LocationAlias_ownerId_locationId_idx` (`ownerId`, `locationId`);

ALTER TABLE `LocationAlias`
  ADD CONSTRAINT `LocationAlias_ownerId_locationId_fkey`
  FOREIGN KEY (`ownerId`, `locationId`) REFERENCES `Location`(`ownerId`, `id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- --- what was repaired -----------------------------------------------------
-- A migration cannot write to the container log, and a silent deletion is not
-- something an operator should have to read the diff to discover. The counts
-- are left where `runStartupTasks` can find them and say so at the next boot,
-- and only when there was something to say.
INSERT INTO `AppSetting` (`key`, `value`, `updatedAt`)
  SELECT 'schemaRepair.sameOwnerJoinKeys',
         JSON_OBJECT('contactTags', @crossOwnerTags, 'locationAliases', @crossOwnerAliases),
         NOW(3)
  FROM DUAL
  WHERE @crossOwnerTags > 0 OR @crossOwnerAliases > 0
  ON DUPLICATE KEY UPDATE
    `value` = JSON_OBJECT('contactTags', @crossOwnerTags, 'locationAliases', @crossOwnerAliases),
    `updatedAt` = NOW(3);
