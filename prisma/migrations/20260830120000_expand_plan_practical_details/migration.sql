-- Preserve existing city text while widening the field to hold a complete address.
ALTER TABLE `Plan`
  CHANGE COLUMN `city` `address` VARCHAR(500) NULL,
  ADD COLUMN `checklist` JSON NULL;

-- Existing plans did not have checklist items. An empty list avoids inventing work.
UPDATE `Plan` SET `checklist` = JSON_ARRAY();
ALTER TABLE `Plan` MODIFY COLUMN `checklist` JSON NOT NULL DEFAULT ('[]');
