-- Existing DietaryNeed rows describe food and drink, so FOOD is the only
-- honest backfill. Users can recategorise exceptional legacy notes later.
ALTER TABLE `Contact`
  ADD COLUMN `allergyStatus` ENUM('UNKNOWN', 'NO_KNOWN', 'KNOWN') NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE `DietaryNeed`
  ADD COLUMN `category` ENUM('FOOD', 'MEDICATION', 'ENVIRONMENTAL', 'OTHER') NOT NULL DEFAULT 'FOOD',
  ADD COLUMN `reaction` TEXT NULL,
  ADD COLUMN `epinephrineLocation` VARCHAR(191) NULL,
  ADD COLUMN `emergencyInstructions` TEXT NULL,
  ADD COLUMN `professionallyDiagnosed` BOOLEAN NULL,
  ADD COLUMN `lastConfirmedOn` DATE NULL;

-- An existing allergy is evidence of a known allergy; dietary restrictions
-- and preferences alone do not establish allergy status.
UPDATE `Contact` c
SET c.`allergyStatus` = 'KNOWN'
WHERE EXISTS (
  SELECT 1 FROM `DietaryNeed` d
  WHERE d.`contactId` = c.`id` AND d.`kind` = 'ALLERGY'
);

-- InnoDB requires an index whose leftmost column is the foreign key column, and
-- `DietaryNeed_contactId_kind_idx` is the only one leading with `contactId`.
-- Dropping it first leaves the DietaryNeed -> Contact constraint uncovered and
-- MariaDB refuses with errno 1553. Create the replacement -- which also leads
-- with `contactId`, so it satisfies the constraint -- before dropping the old one.
CREATE INDEX `DietaryNeed_contactId_category_kind_idx`
  ON `DietaryNeed`(`contactId`, `category`, `kind`);
DROP INDEX `DietaryNeed_contactId_kind_idx` ON `DietaryNeed`;
