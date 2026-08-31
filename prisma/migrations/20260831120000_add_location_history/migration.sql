-- Normalize legacy location text by trimming its ends, collapsing every run of
-- whitespace to one ASCII space, and lower-casing it. The owner is part of both
-- the unique key and every backfill join, so equal names in different accounts
-- can never be combined. Interaction.location remains untouched and lossless.
CREATE TABLE `Location` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `normalizedName` VARCHAR(191) NOT NULL,
    `address` VARCHAR(255) NULL,
    `details` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Location_ownerId_normalizedName_key`(`ownerId`, `normalizedName`),
    INDEX `Location_ownerId_displayName_idx`(`ownerId`, `displayName`),
    PRIMARY KEY (`id`),
    CONSTRAINT `Location_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Interaction` ADD COLUMN `locationId` VARCHAR(191) NULL;

INSERT INTO `Location` (`id`, `ownerId`, `displayName`, `normalizedName`, `updatedAt`)
SELECT CONCAT('loc_', REPLACE(UUID(), '-', '')), source.`ownerId`, MIN(source.`displayName`), source.`normalizedName`, CURRENT_TIMESTAMP(3)
FROM (
    SELECT `ownerId`, TRIM(REGEXP_REPLACE(`location`, '[[:space:]]+', ' ')) AS `displayName`,
           LOWER(TRIM(REGEXP_REPLACE(`location`, '[[:space:]]+', ' '))) AS `normalizedName`
    FROM `Interaction`
    WHERE `location` IS NOT NULL AND TRIM(`location`) <> ''
) AS source
GROUP BY source.`ownerId`, source.`normalizedName`;

UPDATE `Interaction` AS interaction
JOIN `Location` AS location
  ON location.`ownerId` = interaction.`ownerId`
 AND location.`normalizedName` = LOWER(TRIM(REGEXP_REPLACE(interaction.`location`, '[[:space:]]+', ' ')))
SET interaction.`locationId` = location.`id`
WHERE interaction.`location` IS NOT NULL AND TRIM(interaction.`location`) <> '';

CREATE INDEX `Interaction_locationId_idx` ON `Interaction`(`locationId`);
ALTER TABLE `Interaction` ADD CONSTRAINT `Interaction_locationId_fkey`
  FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
