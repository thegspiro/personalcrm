-- Secondary privacy lock, per-item private markers, and the dating
-- retrospective.
--
-- Purely additive: the private markers default to false and the lock defaults
-- to disabled, so an existing install behaves exactly as before until the PIN
-- is deliberately set up.

-- AlterTable
ALTER TABLE `Contact` ADD COLUMN `isPrivate` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Fact` ADD COLUMN `isPrivate` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Interaction` ADD COLUMN `isPrivate` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `RomanticProfile` ADD COLUMN `retrospective` TEXT NULL;

-- AlterTable
ALTER TABLE `Session` ADD COLUMN `privacyUnlockedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `privacyPinFailedAt` DATETIME(3) NULL,
    ADD COLUMN `privacyPinFailedCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `privacyPinHash` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `UserPreference` ADD COLUMN `blurPrivateNotes` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `hideDating` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `privacyLockEnabled` BOOLEAN NOT NULL DEFAULT false;

