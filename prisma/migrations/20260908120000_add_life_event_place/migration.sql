-- AlterTable
ALTER TABLE `LifeEvent` ADD COLUMN `location` VARCHAR(191) NULL,
    ADD COLUMN `locationId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `LifeEvent_locationId_idx` ON `LifeEvent`(`locationId`);

-- AddForeignKey
ALTER TABLE `LifeEvent` ADD CONSTRAINT `LifeEvent_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
