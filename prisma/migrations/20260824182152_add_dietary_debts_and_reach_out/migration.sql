-- AlterTable
ALTER TABLE `Interaction` ADD COLUMN `reachedOutBy` ENUM('UNSPECIFIED', 'ME', 'THEM', 'MUTUAL') NOT NULL DEFAULT 'UNSPECIFIED';

-- CreateTable
CREATE TABLE `Debt` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `direction` ENUM('THEY_OWE_ME', 'I_OWE_THEM') NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `amountCents` INTEGER NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'USD',
    `incurredOn` DATE NOT NULL,
    `settledOn` DATE NULL,
    `notes` TEXT NULL,
    `isPrivate` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Debt_contactId_settledOn_idx`(`contactId`, `settledOn`),
    INDEX `Debt_ownerId_settledOn_idx`(`ownerId`, `settledOn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DietaryNeed` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `kind` ENUM('ALLERGY', 'INTOLERANCE', 'MEDICAL', 'PREFERENCE') NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `notes` TEXT NULL,
    `carriesEpinephrine` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DietaryNeed_contactId_kind_idx`(`contactId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Debt` ADD CONSTRAINT `Debt_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Debt` ADD CONSTRAINT `Debt_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DietaryNeed` ADD CONSTRAINT `DietaryNeed_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DietaryNeed` ADD CONSTRAINT `DietaryNeed_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
