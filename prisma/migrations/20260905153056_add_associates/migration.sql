-- People in a contact's life who are not tracked as contacts themselves — a
-- friend's colleague, a sister's partner. Purely additive: one new table, no
-- existing column re-expressed, no enum modified, nothing to backfill before a
-- drop because nothing is dropped. The table starts empty, so an installation
-- that applies this and rolls back loses nothing that existed before it.
--
-- Named `Associate` rather than `Acquaintance` because the latter is already a
-- CONTACT_CATEGORY label: being categorised an acquaintance is a different
-- fact from being someone your contact knows and you do not track.
--
-- No new taxonomy kind: promoting an entry into a real person writes an
-- ordinary Relationship, so it reuses RELATIONSHIP_TYPE.
--
-- `promotedContactId` names `Contact(id)` alone rather than the same-owner
-- `(ownerId, id)` key every other reference to a person uses. MariaDB refuses
-- a SET NULL foreign key unless every column in it is nullable, and `ownerId`
-- is not — the same exception `Interaction.place` and `Plan.place` carry, with
-- the same remedy: the readers keep an explicit owner predicate. SET NULL
-- rather than CASCADE so that deleting the person an entry became leaves the
-- note the owner wrote, reverted to an ordinary entry.
-- CreateTable
CREATE TABLE `Associate` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `howTheyKnow` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `isPrivate` BOOLEAN NOT NULL DEFAULT false,
    `promotedContactId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Associate_ownerId_contactId_idx`(`ownerId`, `contactId`),
    INDEX `Associate_contactId_name_idx`(`contactId`, `name`),
    INDEX `Associate_promotedContactId_idx`(`promotedContactId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Associate` ADD CONSTRAINT `Associate_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Associate` ADD CONSTRAINT `Associate_ownerId_contactId_fkey` FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Associate` ADD CONSTRAINT `Associate_promotedContactId_fkey` FOREIGN KEY (`promotedContactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
