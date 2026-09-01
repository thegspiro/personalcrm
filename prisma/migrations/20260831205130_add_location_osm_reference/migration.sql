-- AlterTable
ALTER TABLE `Location` ADD COLUMN `osmId` BIGINT NULL,
    ADD COLUMN `osmType` VARCHAR(1) NULL;
