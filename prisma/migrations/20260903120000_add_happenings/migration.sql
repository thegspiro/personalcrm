-- Informal calendar information: one-off, near-future things going on in
-- someone else's life. Purely additive — no existing column is re-expressed,
-- so there is nothing to backfill before a drop and no data can be lost here.

-- Appends HAPPENING_TYPE to the end of the kind enum. Existing values keep
-- their position and their meaning, so no stored row changes.
ALTER TABLE `TaxonomyTerm` MODIFY `kind` ENUM('CONTACT_CATEGORY', 'CONTACT_METHOD_TYPE', 'INTERACTION_TYPE', 'FACT_CATEGORY', 'DATE_TYPE', 'RELATIONSHIP_TYPE', 'DATING_STAGE', 'DATE_ACTIVITY_TYPE', 'MEETING_SOURCE', 'GIFT_OCCASION', 'LIFE_EVENT_TYPE', 'PLAN_CATEGORY', 'HAPPENING_TYPE') NOT NULL;

-- `followUpTaskId` points at Task rather than Task pointing back, so no
-- existing table gains a column. SET NULL means deleting the follow-up task by
-- hand leaves the happening itself intact.
-- CreateTable
CREATE TABLE `Happening` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `typeId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `notes` TEXT NULL,
    `source` VARCHAR(191) NULL,
    `date` DATE NOT NULL,
    `precision` ENUM('DAY', 'MONTH', 'YEAR', 'MONTH_DAY') NOT NULL DEFAULT 'DAY',
    `endDate` DATE NULL,
    `endPrecision` ENUM('DAY', 'MONTH', 'YEAR', 'MONTH_DAY') NULL,
    `availability` ENUM('NONE', 'BUSY', 'AWAY') NOT NULL DEFAULT 'NONE',
    `isTentative` BOOLEAN NOT NULL DEFAULT false,
    `followUpTaskId` VARCHAR(191) NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Happening_followUpTaskId_key`(`followUpTaskId`),
    INDEX `Happening_contactId_date_idx`(`contactId`, `date`),
    INDEX `Happening_ownerId_date_idx`(`ownerId`, `date`),
    INDEX `Happening_ownerId_endDate_idx`(`ownerId`, `endDate`),
    INDEX `Happening_typeId_idx`(`typeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Happening` ADD CONSTRAINT `Happening_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Happening` ADD CONSTRAINT `Happening_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Happening` ADD CONSTRAINT `Happening_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `TaxonomyTerm`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Happening` ADD CONSTRAINT `Happening_followUpTaskId_fkey` FOREIGN KEY (`followUpTaskId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

