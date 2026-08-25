-- AlterTable
ALTER TABLE `TaxonomyTerm` MODIFY `kind` ENUM('CONTACT_CATEGORY', 'CONTACT_METHOD_TYPE', 'INTERACTION_TYPE', 'FACT_CATEGORY', 'DATE_TYPE', 'RELATIONSHIP_TYPE', 'DATING_STAGE', 'DATE_ACTIVITY_TYPE', 'MEETING_SOURCE', 'GIFT_OCCASION', 'LIFE_EVENT_TYPE', 'DATE_IDEA_CATEGORY') NOT NULL;

-- CreateTable
CREATE TABLE `DateIdea` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `city` VARCHAR(120) NULL,
    `url` VARCHAR(500) NULL,
    `estimatedCostCents` INTEGER NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'USD',
    `notes` TEXT NULL,
    `status` ENUM('OPEN', 'PLANNED', 'DONE', 'ARCHIVED') NOT NULL DEFAULT 'OPEN',
    `plannedFor` DATE NULL,
    `usedAt` DATETIME(3) NULL,
    `usedInDateEntryId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DateIdea_ownerId_status_idx`(`ownerId`, `status`),
    INDEX `DateIdea_contactId_status_idx`(`contactId`, `status`),
    INDEX `DateIdea_categoryId_idx`(`categoryId`),
    INDEX `DateIdea_usedInDateEntryId_idx`(`usedInDateEntryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DateIdea` ADD CONSTRAINT `DateIdea_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DateIdea` ADD CONSTRAINT `DateIdea_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DateIdea` ADD CONSTRAINT `DateIdea_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `TaxonomyTerm`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DateIdea` ADD CONSTRAINT `DateIdea_usedInDateEntryId_fkey` FOREIGN KEY (`usedInDateEntryId`) REFERENCES `DateEntry`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
