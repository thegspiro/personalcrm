-- Rollback for 20261005120000_add_associate_note_source_interaction.
--
-- Not run by Prisma; run it by hand with
-- `npx prisma db execute --schema prisma/schema.prisma --file <this file>`, and only
-- against a database that has already applied the migration. Then delete the
-- migration's row from `_prisma_migrations` and deploy the previous release.
--
-- Loses only which conversation each note was heard in. The notes themselves,
-- their dates and who told you stay.
--
-- One thing the previous release does not do: withhold, with the lock closed,
-- a note heard in a private conversation. Notes heard from a private contact
-- are still withheld; a note heard from an ordinary contact in a conversation
-- marked private becomes visible behind a closed lock.
ALTER TABLE `AssociateNote` DROP FOREIGN KEY `AssociateNote_sourceInteractionId_fkey`;
DROP INDEX `AssociateNote_sourceInteractionId_idx` ON `AssociateNote`;
ALTER TABLE `AssociateNote` DROP COLUMN `sourceInteractionId`;
