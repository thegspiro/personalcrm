-- Distinguish people who attended an interaction from people merely discussed.
CREATE TABLE `InteractionMention` (
  `interactionId` VARCHAR(191) NOT NULL,
  `contactId` VARCHAR(191) NOT NULL,
  INDEX `InteractionMention_contactId_idx`(`contactId`),
  PRIMARY KEY (`interactionId`, `contactId`),
  CONSTRAINT `InteractionMention_interactionId_fkey` FOREIGN KEY (`interactionId`) REFERENCES `Interaction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `InteractionMention_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- A life event may belong to several people's histories. Backfill every
-- existing event before new writers begin using the join.
CREATE TABLE `LifeEventParticipant` (
  `lifeEventId` VARCHAR(191) NOT NULL,
  `contactId` VARCHAR(191) NOT NULL,
  INDEX `LifeEventParticipant_contactId_idx`(`contactId`),
  PRIMARY KEY (`lifeEventId`, `contactId`),
  CONSTRAINT `LifeEventParticipant_lifeEventId_fkey` FOREIGN KEY (`lifeEventId`) REFERENCES `LifeEvent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `LifeEventParticipant_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `LifeEventParticipant` (`lifeEventId`, `contactId`)
SELECT `id`, `contactId` FROM `LifeEvent`;
