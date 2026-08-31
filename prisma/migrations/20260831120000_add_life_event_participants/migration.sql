-- Replace the single contact edge with explicit participants without losing an
-- existing association. The copy happens before the now-redundant column is
-- removed, so every historical event remains attached to the same profile.
CREATE TABLE `LifeEventParticipant` (
    `lifeEventId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,

    INDEX `LifeEventParticipant_contactId_lifeEventId_idx`(`contactId`, `lifeEventId`),
    PRIMARY KEY (`lifeEventId`, `contactId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `LifeEventParticipant` (`lifeEventId`, `contactId`)
SELECT `id`, `contactId` FROM `LifeEvent`;

ALTER TABLE `LifeEventParticipant`
  ADD CONSTRAINT `LifeEventParticipant_lifeEventId_fkey`
  FOREIGN KEY (`lifeEventId`) REFERENCES `LifeEvent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `LifeEventParticipant_contactId_fkey`
  FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- The participant rows now contain the complete legacy association. Keeping
-- contactId would preserve two competing sources of truth and its cascading
-- foreign key could delete a shared event when only one participant is deleted.
ALTER TABLE `LifeEvent` DROP FOREIGN KEY `LifeEvent_contactId_fkey`;
DROP INDEX `LifeEvent_contactId_date_idx` ON `LifeEvent`;
ALTER TABLE `LifeEvent` DROP COLUMN `contactId`, ADD COLUMN `isPrivate` BOOLEAN NOT NULL DEFAULT false, ADD COLUMN `spouseRelationshipPairId` VARCHAR(32) NULL;
