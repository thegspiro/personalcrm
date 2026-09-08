-- Pairs the owner has said are not the same person.
--
-- A new table only: nothing existing is altered, dropped or re-expressed, so
-- there is nothing to back-fill ahead of a drop and this is safe to apply to a
-- database already holding rows. Every account starts with none, which is what
-- every account has today.
--
-- The contact keys are the same-owner composite the rest of the schema uses, so
-- a dismissal cannot be made to span two accounts.

-- CreateTable
CREATE TABLE `DuplicateDismissal` (
    `ownerId` VARCHAR(191) NOT NULL,
    `aContactId` VARCHAR(191) NOT NULL,
    `bContactId` VARCHAR(191) NOT NULL,
    `dismissedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DuplicateDismissal_aContactId_idx`(`aContactId`),
    INDEX `DuplicateDismissal_bContactId_idx`(`bContactId`),
    PRIMARY KEY (`ownerId`, `aContactId`, `bContactId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DuplicateDismissal` ADD CONSTRAINT `DuplicateDismissal_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DuplicateDismissal` ADD CONSTRAINT `DuplicateDismissal_ownerId_aContactId_fkey` FOREIGN KEY (`ownerId`, `aContactId`) REFERENCES `Contact`(`ownerId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DuplicateDismissal` ADD CONSTRAINT `DuplicateDismissal_ownerId_bContactId_fkey` FOREIGN KEY (`ownerId`, `bContactId`) REFERENCES `Contact`(`ownerId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

