-- AlterTable
ALTER TABLE `UserPreference`
    ADD COLUMN `onboardingCompletedAt` DATETIME(3) NULL,
    ADD COLUMN `pwaInstalledAt` DATETIME(3) NULL;

-- Existing accounts have already been through whatever setup there was. A null
-- here sends the app shell to /welcome, so backfilling is what stops an upgrade
-- from dragging every current user into a first-run wizard.
UPDATE `UserPreference` SET `onboardingCompletedAt` = CURRENT_TIMESTAMP(3);
