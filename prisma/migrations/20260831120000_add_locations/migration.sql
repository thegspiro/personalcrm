-- Canonical, owner-scoped places. Existing labels remain on Interaction and Plan
-- so the upgrade is lossless even when two historical spellings are later merged.
CREATE TABLE `Location` (
  `id` VARCHAR(191) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `normalizedName` VARCHAR(191) NOT NULL,
  `address` VARCHAR(500) NULL,
  `city` VARCHAR(120) NULL,
  `region` VARCHAR(120) NULL,
  `country` VARCHAR(120) NULL,
  `url` VARCHAR(500) NULL,
  `phone` VARCHAR(64) NULL,
  `notes` TEXT NULL,
  `latitude` DECIMAL(10,7) NULL,
  `longitude` DECIMAL(10,7) NULL,
  `aliases` JSON NOT NULL DEFAULT ('[]'),
  `isArchived` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Location_ownerId_normalizedName_key`(`ownerId`, `normalizedName`),
  INDEX `Location_ownerId_isArchived_name_idx`(`ownerId`, `isArchived`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Interaction` ADD COLUMN `locationId` VARCHAR(191) NULL,
  ADD INDEX `Interaction_locationId_idx`(`locationId`);
ALTER TABLE `Plan` ADD COLUMN `locationId` VARCHAR(191) NULL,
  ADD INDEX `Plan_locationId_idx`(`locationId`);

-- Only trim/case-fold during automatic backfill. Fuzzy similarities are not
-- evidence that two historical places are the same.
INSERT INTO `Location` (`id`, `ownerId`, `name`, `normalizedName`, `updatedAt`)
SELECT CONCAT('loc_', SHA2(CONCAT(`ownerId`, CHAR(0), LOWER(TRIM(`location`))), 256)),
       `ownerId`, MIN(TRIM(`location`)), LOWER(TRIM(`location`)), CURRENT_TIMESTAMP(3)
FROM `Interaction`
WHERE `location` IS NOT NULL AND TRIM(`location`) <> ''
GROUP BY `ownerId`, LOWER(TRIM(`location`));

INSERT IGNORE INTO `Location` (`id`, `ownerId`, `name`, `normalizedName`, `address`, `updatedAt`)
SELECT CONCAT('loc_', SHA2(CONCAT(`ownerId`, CHAR(0), LOWER(TRIM(`location`))), 256)),
       `ownerId`, MIN(TRIM(`location`)), LOWER(TRIM(`location`)), MIN(`address`), CURRENT_TIMESTAMP(3)
FROM `Plan`
WHERE `location` IS NOT NULL AND TRIM(`location`) <> ''
GROUP BY `ownerId`, LOWER(TRIM(`location`));

UPDATE `Interaction` i JOIN `Location` l
  ON l.`ownerId` = i.`ownerId` AND l.`normalizedName` = LOWER(TRIM(i.`location`))
SET i.`locationId` = l.`id` WHERE i.`location` IS NOT NULL;
UPDATE `Plan` p JOIN `Location` l
  ON l.`ownerId` = p.`ownerId` AND l.`normalizedName` = LOWER(TRIM(p.`location`))
SET p.`locationId` = l.`id` WHERE p.`location` IS NOT NULL;

ALTER TABLE `Location` ADD CONSTRAINT `Location_ownerId_fkey`
  FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Interaction` ADD CONSTRAINT `Interaction_locationId_fkey`
  FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Plan` ADD CONSTRAINT `Plan_locationId_fkey`
  FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
