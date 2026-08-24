-- Life events, and replacing the ad-hoc "year unknown" booleans with a single
-- DatePrecision concept.
--
-- The precision columns are added, backfilled from the old booleans, and only
-- then are the booleans dropped. Prisma's generated diff does a bare
-- DROP + ADD, which would silently turn every "year unknown" birthday into a
-- date that claims to know the year.

-- AlterEnum: add LIFE_EVENT_TYPE
ALTER TABLE `TaxonomyTerm` MODIFY `kind` ENUM('CONTACT_CATEGORY', 'CONTACT_METHOD_TYPE', 'INTERACTION_TYPE', 'FACT_CATEGORY', 'DATE_TYPE', 'RELATIONSHIP_TYPE', 'DATING_STAGE', 'DATE_ACTIVITY_TYPE', 'MEETING_SOURCE', 'GIFT_OCCASION', 'LIFE_EVENT_TYPE') NOT NULL;

-- Contact: birthYearKnown -> birthDatePrecision, plus metOnPrecision
ALTER TABLE `Contact`
    ADD COLUMN `birthDatePrecision` ENUM('DAY', 'MONTH', 'YEAR', 'MONTH_DAY') NOT NULL DEFAULT 'DAY',
    ADD COLUMN `metOnPrecision` ENUM('DAY', 'MONTH', 'YEAR', 'MONTH_DAY') NOT NULL DEFAULT 'DAY';

UPDATE `Contact` SET `birthDatePrecision` = 'MONTH_DAY' WHERE `birthYearKnown` = FALSE;

ALTER TABLE `Contact` DROP COLUMN `birthYearKnown`;

-- ImportantDate: yearKnown -> precision
ALTER TABLE `ImportantDate`
    ADD COLUMN `precision` ENUM('DAY', 'MONTH', 'YEAR', 'MONTH_DAY') NOT NULL DEFAULT 'DAY';

UPDATE `ImportantDate` SET `precision` = 'MONTH_DAY' WHERE `yearKnown` = FALSE;

ALTER TABLE `ImportantDate` DROP COLUMN `yearKnown`;

-- CreateTable
CREATE TABLE `LifeEvent` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `typeId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `date` DATE NOT NULL,
    `precision` ENUM('DAY', 'MONTH', 'YEAR', 'MONTH_DAY') NOT NULL DEFAULT 'DAY',
    `endDate` DATE NULL,
    `endPrecision` ENUM('DAY', 'MONTH', 'YEAR', 'MONTH_DAY') NULL,
    `isMilestone` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LifeEvent_contactId_date_idx`(`contactId`, `date`),
    INDEX `LifeEvent_ownerId_date_idx`(`ownerId`, `date`),
    INDEX `LifeEvent_typeId_idx`(`typeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LifeEvent` ADD CONSTRAINT `LifeEvent_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LifeEvent` ADD CONSTRAINT `LifeEvent_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LifeEvent` ADD CONSTRAINT `LifeEvent_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `TaxonomyTerm`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
