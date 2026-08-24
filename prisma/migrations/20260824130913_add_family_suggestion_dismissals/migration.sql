-- CreateTable
CREATE TABLE `FamilySuggestionDismissal` (
    `ownerId` VARCHAR(191) NOT NULL,
    `aContactId` VARCHAR(191) NOT NULL,
    `bContactId` VARCHAR(191) NOT NULL,
    `dismissedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FamilySuggestionDismissal_aContactId_idx`(`aContactId`),
    INDEX `FamilySuggestionDismissal_bContactId_idx`(`bContactId`),
    PRIMARY KEY (`ownerId`, `aContactId`, `bContactId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `FamilySuggestionDismissal` ADD CONSTRAINT `FamilySuggestionDismissal_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FamilySuggestionDismissal` ADD CONSTRAINT `FamilySuggestionDismissal_aContactId_fkey` FOREIGN KEY (`aContactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FamilySuggestionDismissal` ADD CONSTRAINT `FamilySuggestionDismissal_bContactId_fkey` FOREIGN KEY (`bContactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
