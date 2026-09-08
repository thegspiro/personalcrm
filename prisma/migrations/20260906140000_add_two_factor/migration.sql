-- Two-factor sign-in: the shared secret, and single-use ways back in.
--
-- New tables only. Nothing existing is altered, dropped or re-expressed, so
-- there is nothing to back-fill ahead of a drop and this is safe to apply to a
-- database already holding rows. Every account is unaffected until somebody
-- turns the feature on: no row here means no second factor, which is what
-- every existing account has.

-- CreateTable
CREATE TABLE `TwoFactor` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `secret` TEXT NOT NULL,
    `confirmedAt` DATETIME(3) NULL,
    `lastUsedStep` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TwoFactor_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecoveryCode` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RecoveryCode_ownerId_usedAt_idx`(`ownerId`, `usedAt`),
    UNIQUE INDEX `RecoveryCode_ownerId_codeHash_key`(`ownerId`, `codeHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TwoFactor` ADD CONSTRAINT `TwoFactor_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecoveryCode` ADD CONSTRAINT `RecoveryCode_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

