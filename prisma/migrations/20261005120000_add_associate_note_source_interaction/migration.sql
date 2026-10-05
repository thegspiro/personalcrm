-- Which logged conversation an associate note was heard in, for notes written
-- while logging one. Purely additive: one nullable column, its index and its
-- key. No existing column is re-expressed and nothing is backfilled — every
-- note written before this has no recorded conversation, which is the truth.
--
-- A single-column `SET NULL` key, like `Fact.sourceInteractionId`: MariaDB
-- refuses `SET NULL` on a composite key unless every column is nullable, and
-- `ownerId` is not. The writing action holds the owner instead.
ALTER TABLE `AssociateNote` ADD COLUMN `sourceInteractionId` VARCHAR(191) NULL;

CREATE INDEX `AssociateNote_sourceInteractionId_idx` ON `AssociateNote`(`sourceInteractionId`);

ALTER TABLE `AssociateNote` ADD CONSTRAINT `AssociateNote_sourceInteractionId_fkey` FOREIGN KEY (`sourceInteractionId`) REFERENCES `Interaction`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
