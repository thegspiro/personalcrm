-- CreateTable
CREATE TABLE `PostalCode` (
    `id` VARCHAR(191) NOT NULL,
    `country` VARCHAR(2) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `lookup` VARCHAR(20) NOT NULL,
    `place` VARCHAR(180) NOT NULL,
    `region` VARCHAR(100) NULL,

    INDEX `PostalCode_lookup_idx`(`lookup`),
    UNIQUE INDEX `PostalCode_country_lookup_place_key`(`country`, `lookup`, `place`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PostalCodeSource` (
    `country` VARCHAR(2) NOT NULL,
    `rows` INTEGER NOT NULL,
    `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`country`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

