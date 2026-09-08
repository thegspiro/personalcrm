-- The read-only iCalendar subscription URL, one per account.
--
-- A new table only: nothing existing is altered, dropped or re-expressed, so
-- there is nothing to back-fill ahead of a drop and the migration is safe to
-- apply to a database already holding rows.
--
-- `tokenHash` is unique because it is the lookup key the feed route resolves a
-- request by, and `ownerId` is unique because regenerating replaces the single
-- token rather than adding a second one. `token` holds the same value
-- encrypted at rest, so Settings can show the URL again without the database
-- alone being enough to reconstruct working ones.

-- CreateTable
CREATE TABLE `CalendarFeed` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `token` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastAccessedAt` DATETIME(3) NULL,

    UNIQUE INDEX `CalendarFeed_ownerId_key`(`ownerId`),
    UNIQUE INDEX `CalendarFeed_tokenHash_key`(`tokenHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CalendarFeed` ADD CONSTRAINT `CalendarFeed_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
