-- CreateTable
CREATE TABLE `Household` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Household_ownerId_idx`(`ownerId`),
    UNIQUE INDEX `Household_ownerId_name_key`(`ownerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HouseholdMember` (
    `householdId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(96) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `HouseholdMember_contactId_idx`(`contactId`),
    PRIMARY KEY (`householdId`, `contactId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Household` ADD CONSTRAINT `Household_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HouseholdMember` ADD CONSTRAINT `HouseholdMember_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HouseholdMember` ADD CONSTRAINT `HouseholdMember_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
