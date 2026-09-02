-- Add an owner-scoped, indexed identity namespace for canonical place names
-- and aliases. Location.aliases remains in place: ambiguous legacy claims are
-- deliberately not guessed away and remain available for manual resolution.
CREATE TABLE `LocationAlias` (
  `id` VARCHAR(191) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `value` VARCHAR(191) NOT NULL,
  `normalizedValue` VARCHAR(191) NOT NULL,
  `isCanonical` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `LocationAlias_ownerId_normalizedValue_key`(`ownerId`, `normalizedValue`),
  INDEX `LocationAlias_locationId_idx`(`locationId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `LocationAlias_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `LocationAlias_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Every canonical name claims its normalized identity first.
INSERT INTO `LocationAlias` (`id`, `ownerId`, `locationId`, `value`, `normalizedValue`, `isCanonical`)
SELECT CONCAT('loc_alias_', REPLACE(UUID(), '-', '')), `ownerId`, `id`, `name`, `normalizedName`, true
FROM `Location`;

-- Backfill only unambiguous JSON aliases. JSON_TABLE turns the old array into
-- rows; values claimed by multiple locations (or another canonical name) stay
-- solely in Location.aliases for manual resolution instead of picking a winner.
INSERT INTO `LocationAlias` (`id`, `ownerId`, `locationId`, `value`, `normalizedValue`, `isCanonical`)
SELECT CONCAT('loc_alias_', REPLACE(UUID(), '-', '')), candidate.ownerId, candidate.locationId,
       candidate.value, candidate.normalizedValue, false
FROM (
  SELECT l.`ownerId`, l.`id` AS locationId, TRIM(j.aliasValue) AS value,
         LOWER(REGEXP_REPLACE(TRIM(j.aliasValue), '[[:space:]]+', ' ')) AS normalizedValue
  FROM `Location` l
  JOIN JSON_TABLE(l.`aliases`, '$[*]' COLUMNS(aliasValue VARCHAR(191) PATH '$')) j
  WHERE TRIM(j.aliasValue) <> ''
) candidate
LEFT JOIN `LocationAlias` claimed
  ON claimed.ownerId = candidate.ownerId AND claimed.normalizedValue = candidate.normalizedValue
WHERE claimed.id IS NULL
  AND (SELECT COUNT(DISTINCT l2.`id`)
       FROM `Location` l2
       JOIN JSON_TABLE(l2.`aliases`, '$[*]' COLUMNS(aliasValue VARCHAR(191) PATH '$')) j2
       WHERE l2.`ownerId` = candidate.ownerId
         AND LOWER(REGEXP_REPLACE(TRIM(j2.aliasValue), '[[:space:]]+', ' ')) = candidate.normalizedValue) = 1
GROUP BY candidate.ownerId, candidate.locationId, candidate.normalizedValue, candidate.value;
