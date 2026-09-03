-- Reverses 20260903140000_same_owner_join_keys.
--
-- Prisma has no down-migration mechanism and ignores every file here but
-- `migration.sql`, so this is run by hand:
--
--   mariadb -u <user> -p <database> < down.sql
--
-- It restores the single-column foreign keys and drops the owner column that
-- `ContactTag` gained. What it cannot restore is the rows the forward
-- migration deleted — joins between records belonging to different accounts,
-- which nothing could read and the application could not have written. Take a
-- backup first if that matters; `/config/backups` has last night's.

ALTER TABLE `ContactTag` DROP FOREIGN KEY `ContactTag_ownerId_contactId_fkey`;
ALTER TABLE `ContactTag` DROP FOREIGN KEY `ContactTag_ownerId_tagId_fkey`;
ALTER TABLE `ContactTag` DROP INDEX `ContactTag_ownerId_tagId_idx`;
ALTER TABLE `ContactTag` DROP COLUMN `ownerId`;
ALTER TABLE `ContactTag`
  ADD CONSTRAINT `ContactTag_contactId_fkey`
  FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ContactTag`
  ADD CONSTRAINT `ContactTag_tagId_fkey`
  FOREIGN KEY (`tagId`) REFERENCES `Tag`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `LocationAlias` DROP FOREIGN KEY `LocationAlias_ownerId_locationId_fkey`;
ALTER TABLE `LocationAlias` DROP INDEX `LocationAlias_ownerId_locationId_idx`;
ALTER TABLE `LocationAlias`
  ADD CONSTRAINT `LocationAlias_locationId_fkey`
  FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Contact`  DROP INDEX `Contact_ownerId_id_key`;
ALTER TABLE `Tag`      DROP INDEX `Tag_ownerId_id_key`;
ALTER TABLE `Location` DROP INDEX `Location_ownerId_id_key`;

DELETE FROM `AppSetting` WHERE `key` = 'schemaRepair.sameOwnerJoinKeys';
