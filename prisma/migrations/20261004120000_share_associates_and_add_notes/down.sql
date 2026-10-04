-- Rollback for 20261004120000_share_associates_and_add_notes.
--
-- Not run by Prisma; run it by hand with
-- `npx prisma db execute --schema prisma/schema.prisma --file <this file>`, and only
-- against a database that has already applied the migration. Then delete the
-- migration's row from `_prisma_migrations` and deploy the previous release.
--
-- The old shape holds one contact, one wording and one note per entry, so it
-- cannot hold everything the new one can. What it does with the difference:
--
--   * An associate linked to several contacts goes back to the contact it was
--     linked to first, with that link's wording. The other links are lost.
--   * Every note is folded into the single `notes` column, details first and
--     then updates oldest to newest, an update prefixed with its date. Who
--     each note was heard from is lost.
--   * An associate with no links at all — possible only if its last contact
--     was deleted outside the app — has nowhere to hang and is deleted.
--
-- Take a dump before rolling back if any of that matters — see docs/backup.md.

-- `GROUP_CONCAT` truncates at 1024 bytes by default, which would cut a long
-- note history short without saying so.
SET SESSION group_concat_max_len = 16777216;

ALTER TABLE `Associate`
    ADD COLUMN `contactId` VARCHAR(191) NULL,
    ADD COLUMN `howTheyKnow` VARCHAR(191) NULL,
    ADD COLUMN `notes` TEXT NULL;

-- The earliest link, with the contact id breaking a tie so the choice is
-- stable rather than whatever order the engine reads rows in.
UPDATE `Associate` a
  JOIN `AssociateLink` l
    ON l.`associateId` = a.`id`
   AND l.`contactId` = (
         SELECT l2.`contactId`
           FROM `AssociateLink` l2
          WHERE l2.`associateId` = a.`id`
          ORDER BY l2.`createdAt` ASC, l2.`contactId` ASC
          LIMIT 1
       )
   SET a.`contactId` = l.`contactId`,
       a.`howTheyKnow` = l.`howTheyKnow`;

UPDATE `Associate` a
   SET a.`notes` = (
         SELECT GROUP_CONCAT(
                  CASE
                    WHEN n.`kind` = 'UPDATE' AND n.`date` IS NOT NULL
                      THEN CONCAT(DATE_FORMAT(n.`date`, '%Y-%m-%d'), ': ', n.`content`)
                    ELSE n.`content`
                  END
                  ORDER BY (n.`kind` = 'UPDATE') ASC, n.`date` ASC, n.`createdAt` ASC
                  SEPARATOR '\n\n')
           FROM `AssociateNote` n
          WHERE n.`associateId` = a.`id`
       );

DELETE FROM `Associate` WHERE `contactId` IS NULL;

ALTER TABLE `Associate` MODIFY `contactId` VARCHAR(191) NOT NULL;

DROP TABLE `AssociateNote`;
DROP TABLE `AssociateLink`;

CREATE INDEX `Associate_ownerId_contactId_idx` ON `Associate`(`ownerId`, `contactId`);
CREATE INDEX `Associate_contactId_name_idx` ON `Associate`(`contactId`, `name`);
ALTER TABLE `Associate` ADD CONSTRAINT `Associate_ownerId_contactId_fkey` FOREIGN KEY (`ownerId`, `contactId`) REFERENCES `Contact`(`ownerId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Dropped last: until the index above exists, these are what cover the owner
-- foreign key.
DROP INDEX `Associate_ownerId_name_idx` ON `Associate`;
DROP INDEX `Associate_ownerId_id_key` ON `Associate`;
