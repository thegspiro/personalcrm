-- A complete street address is distinct from a venue name and compact city.
-- Nullable and additive so every existing plan is preserved unchanged.
ALTER TABLE `Plan` ADD COLUMN `address` VARCHAR(500) NULL;
