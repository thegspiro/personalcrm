-- An associate stops belonging to one contact. The same colleague can be in
-- two of your friends' lives, so the person becomes an account-owned row and
-- each friend becomes an `AssociateLink` carrying how *that* friend knows
-- them. What you know about them becomes `AssociateNote` rows — a standing
-- detail or a dated update — each recording which friend you heard it from,
-- so that what Alice told you is never offered as something to raise with Bob.
--
-- **Hand-edited.** Prisma generates this as a drop of `contactId`,
-- `howTheyKnow` and `notes`, which would take every existing entry's friend,
-- wording and note with it. The order below is what keeps them:
--
--   1. The new keys `Associate` needs go on first. `Associate_ownerId_fkey`
--      is covered today by the `(ownerId, contactId)` index that step 4 drops,
--      and MariaDB refuses to drop the last index a foreign key can use.
--   2. The two tables are created.
--   3. Backfill, before anything is dropped: one link per existing entry, to
--      the contact it hung off, carrying its wording; one DETAIL note per
--      non-blank `notes`, heard from that same contact — the only person it
--      could have come from when it was written on their page.
--   4. Only then the old key, indexes and columns go.
--   5. The new foreign keys go on last, against rows that already satisfy
--      them by construction.
--
-- No entries are merged. Two rows that are plainly the same person under two
-- friends stay two rows until someone says they are the same — guessing from
-- a first name would fold two different Bobs together, and that cannot be
-- undone from the data alone.
--
-- `down.sql` beside this reverses the shape; see it for what it cannot keep.

-- 1. Keys the new same-owner relations point at, and the index that takes
--    over from the one being dropped.
CREATE UNIQUE INDEX `Associate_ownerId_id_key` ON `Associate`(`ownerId`, `id`);
CREATE INDEX `Associate_ownerId_name_idx` ON `Associate`(`ownerId`, `name`);

-- 2. The new tables.
CREATE TABLE `AssociateLink` (
    `ownerId` VARCHAR(191) NOT NULL,
    `associateId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `howTheyKnow` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AssociateLink_ownerId_contactId_idx`(`ownerId`, `contactId`),
    INDEX `AssociateLink_ownerId_associateId_idx`(`ownerId`, `associateId`),
    PRIMARY KEY (`associateId`, `contactId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AssociateNote` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `associateId` VARCHAR(191) NOT NULL,
    `kind` ENUM('DETAIL', 'UPDATE') NOT NULL,
    `content` TEXT NOT NULL,
    `date` DATE NULL,
    `precision` ENUM('DAY', 'MONTH', 'YEAR', 'MONTH_DAY') NOT NULL DEFAULT 'DAY',
    `heardFromContactId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AssociateNote_ownerId_associateId_kind_idx`(`ownerId`, `associateId`, `kind`),
    INDEX `AssociateNote_ownerId_heardFromContactId_idx`(`ownerId`, `heardFromContactId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 3. Backfill. Timestamps are the entry's own, so the history reads as it
--    was written rather than as the day of the upgrade.
INSERT INTO `AssociateLink` (`ownerId`, `associateId`, `contactId`, `howTheyKnow`, `createdAt`, `updatedAt`)
SELECT `ownerId`, `id`, `contactId`, `howTheyKnow`, `createdAt`, `updatedAt`
  FROM `Associate`;

INSERT INTO `AssociateNote` (`id`, `ownerId`, `associateId`, `kind`, `content`, `date`, `precision`, `heardFromContactId`, `createdAt`, `updatedAt`)
SELECT CONCAT('asn_', REPLACE(UUID(), '-', '')), `ownerId`, `id`, 'DETAIL', `notes`, NULL, 'DAY', `contactId`, `createdAt`, `updatedAt`
  FROM `Associate`
 WHERE `notes` IS NOT NULL AND TRIM(`notes`) <> '';

-- 4. The single-contact shape goes.
ALTER TABLE `Associate` DROP FOREIGN KEY `Associate_ownerId_contactId_fkey`;
DROP INDEX `Associate_contactId_name_idx` ON `Associate`;
DROP INDEX `Associate_ownerId_contactId_idx` ON `Associate`;
ALTER TABLE `Associate` DROP COLUMN `contactId`,
    DROP COLUMN `howTheyKnow`,
    DROP COLUMN `notes`;

-- 5. The new keys. CASCADE on the note's source: deleting a friend deletes
--    what you heard from them, as deleting a contact always did to the notes
--    on their associates. SET NULL would re-attribute it to nobody — and a
--    note heard from a private contact would then show with the lock closed.
ALTER TABLE `AssociateLink` ADD CONSTRAINT `AssociateLink_ownerId_associateId_fkey` FOREIGN KEY (`ownerId`, `associateId`) REFERENCES `Associate`(`ownerId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AssociateLink` ADD CONSTRAINT `AssociateLink_ownerId_contactId_fkey` FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AssociateNote` ADD CONSTRAINT `AssociateNote_ownerId_associateId_fkey` FOREIGN KEY (`ownerId`, `associateId`) REFERENCES `Associate`(`ownerId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AssociateNote` ADD CONSTRAINT `AssociateNote_ownerId_heardFromContactId_fkey` FOREIGN KEY (`ownerId`, `heardFromContactId`) REFERENCES `Contact`(`ownerId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
