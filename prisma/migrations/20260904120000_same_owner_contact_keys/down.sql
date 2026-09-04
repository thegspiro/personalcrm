-- Rollback for 20260904120000_same_owner_contact_keys.
--
-- Not run by Prisma; `npx prisma db execute --file` it by hand, and only
-- against a database that has already applied the migration. It restores the
-- single-column foreign keys and removes the indexes the composite keys
-- needed.
--
-- What it cannot restore is the repair: rows the migration deleted and links it
-- set to NULL are gone. Take a dump before upgrading if that matters — see
-- docs/backup.md.

ALTER TABLE `Relationship` DROP FOREIGN KEY `Relationship_ownerId_fromContactId_fkey`;
ALTER TABLE `Relationship` DROP FOREIGN KEY `Relationship_ownerId_toContactId_fkey`;
ALTER TABLE `Relationship` DROP INDEX `Relationship_ownerId_fromContactId_idx`;
ALTER TABLE `Relationship` DROP INDEX `Relationship_ownerId_toContactId_idx`;
ALTER TABLE `Relationship` ADD CONSTRAINT `Relationship_fromContactId_fkey` FOREIGN KEY (`fromContactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Relationship` ADD CONSTRAINT `Relationship_toContactId_fkey` FOREIGN KEY (`toContactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Fact` DROP FOREIGN KEY `Fact_ownerId_contactId_fkey`;
ALTER TABLE `Fact` DROP INDEX `Fact_ownerId_contactId_idx`;
ALTER TABLE `Fact` ADD CONSTRAINT `Fact_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ImportantDate` DROP FOREIGN KEY `ImportantDate_ownerId_contactId_fkey`;
ALTER TABLE `ImportantDate` DROP INDEX `ImportantDate_ownerId_contactId_idx`;
ALTER TABLE `ImportantDate` ADD CONSTRAINT `ImportantDate_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `LifeEvent` DROP FOREIGN KEY `LifeEvent_ownerId_contactId_fkey`;
ALTER TABLE `LifeEvent` DROP INDEX `LifeEvent_ownerId_contactId_idx`;
ALTER TABLE `LifeEvent` ADD CONSTRAINT `LifeEvent_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `FamilySuggestionDismissal` DROP FOREIGN KEY `FamilySuggestionDismissal_ownerId_aContactId_fkey`;
ALTER TABLE `FamilySuggestionDismissal` DROP FOREIGN KEY `FamilySuggestionDismissal_ownerId_bContactId_fkey`;
ALTER TABLE `FamilySuggestionDismissal` DROP INDEX `FamilySuggestionDismissal_ownerId_bContactId_idx`;
ALTER TABLE `FamilySuggestionDismissal` ADD CONSTRAINT `FamilySuggestionDismissal_aContactId_fkey` FOREIGN KEY (`aContactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `FamilySuggestionDismissal` ADD CONSTRAINT `FamilySuggestionDismissal_bContactId_fkey` FOREIGN KEY (`bContactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Idea` DROP FOREIGN KEY `Idea_ownerId_contactId_fkey`;
ALTER TABLE `Idea` DROP INDEX `Idea_ownerId_contactId_idx`;
ALTER TABLE `Idea` ADD CONSTRAINT `Idea_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Task` DROP FOREIGN KEY `Task_ownerId_contactId_fkey`;
ALTER TABLE `Task` DROP INDEX `Task_ownerId_contactId_idx`;
ALTER TABLE `Task` ADD CONSTRAINT `Task_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Happening` DROP FOREIGN KEY `Happening_ownerId_contactId_fkey`;
ALTER TABLE `Happening` DROP INDEX `Happening_ownerId_contactId_idx`;
ALTER TABLE `Happening` ADD CONSTRAINT `Happening_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Gift` DROP FOREIGN KEY `Gift_ownerId_contactId_fkey`;
ALTER TABLE `Gift` DROP INDEX `Gift_ownerId_contactId_idx`;
ALTER TABLE `Gift` ADD CONSTRAINT `Gift_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Debt` DROP FOREIGN KEY `Debt_ownerId_contactId_fkey`;
ALTER TABLE `Debt` DROP INDEX `Debt_ownerId_contactId_idx`;
ALTER TABLE `Debt` ADD CONSTRAINT `Debt_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `DietaryNeed` DROP FOREIGN KEY `DietaryNeed_ownerId_contactId_fkey`;
ALTER TABLE `DietaryNeed` DROP INDEX `DietaryNeed_ownerId_contactId_idx`;
ALTER TABLE `DietaryNeed` ADD CONSTRAINT `DietaryNeed_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `RomanticProfile` DROP FOREIGN KEY `RomanticProfile_ownerId_contactId_fkey`;
ALTER TABLE `RomanticProfile` DROP INDEX `RomanticProfile_ownerId_contactId_key`;
ALTER TABLE `RomanticProfile` ADD CONSTRAINT `RomanticProfile_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `DateEntry` DROP FOREIGN KEY `DateEntry_ownerId_contactId_fkey`;
ALTER TABLE `DateEntry` DROP INDEX `DateEntry_ownerId_contactId_idx`;
ALTER TABLE `DateEntry` ADD CONSTRAINT `DateEntry_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Plan` DROP FOREIGN KEY `Plan_ownerId_contactId_fkey`;
ALTER TABLE `Plan` DROP INDEX `Plan_ownerId_contactId_idx`;
ALTER TABLE `Plan` ADD CONSTRAINT `Plan_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Flag` DROP FOREIGN KEY `Flag_ownerId_contactId_fkey`;
ALTER TABLE `Flag` DROP INDEX `Flag_ownerId_contactId_idx`;
ALTER TABLE `Flag` ADD CONSTRAINT `Flag_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

DELETE FROM `AppSetting` WHERE `key` = 'schemaRepair.sameOwnerContactKeys';
