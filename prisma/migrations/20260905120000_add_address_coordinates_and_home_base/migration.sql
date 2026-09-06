-- Coordinates on a contact's address, and a home base to measure from.
--
-- Entirely additive: every column is nullable or defaulted, nothing is removed
-- and nothing is renamed, so an existing installation upgrades with no backfill
-- and reads exactly as it did before. Reversing it means removing the eleven
-- columns added below and nothing else, since no existing data is touched.
--
-- Types mirror `Location` deliberately — DECIMAL(10,7) for coordinates,
-- VARCHAR(1) for the OSM object kind, BIGINT for the id, which is past 2^32 —
-- so one coordinate reader serves every table that holds a point.
ALTER TABLE `Address`
  ADD COLUMN `latitude` DECIMAL(10,7) NULL,
  ADD COLUMN `longitude` DECIMAL(10,7) NULL,
  ADD COLUMN `osmType` VARCHAR(1) NULL,
  ADD COLUMN `osmId` BIGINT NULL;

-- Your own location lives on the preference row rather than in `Location`: a
-- home is where distances are counted from, not a venue with a history.
ALTER TABLE `UserPreference`
  ADD COLUMN `homeAddress` VARCHAR(500) NULL,
  ADD COLUMN `homeCity` VARCHAR(120) NULL,
  ADD COLUMN `homeRegion` VARCHAR(120) NULL,
  ADD COLUMN `homeCountry` VARCHAR(120) NULL,
  ADD COLUMN `homeLatitude` DECIMAL(10,7) NULL,
  ADD COLUMN `homeLongitude` DECIMAL(10,7) NULL,
  ADD COLUMN `distanceUnit` VARCHAR(8) NOT NULL DEFAULT 'mi';
