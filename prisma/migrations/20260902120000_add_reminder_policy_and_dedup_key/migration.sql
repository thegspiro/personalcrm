ALTER TABLE `ReminderLog`
  ADD COLUMN `schedulingPolicy` VARCHAR(32) NOT NULL DEFAULT 'IMPORTANT_DATE_OFFSET',
  ADD COLUMN `dedupKey` VARCHAR(64) NULL;

-- Every row that exists was written by the important-date policy, which was the
-- only one; the temporary default above labels them all correctly.
--
-- The key has to be unique per owner. The delivery key it is derived from is
-- not quite: deleting a channel sets `channelId` to NULL, and a unique index
-- never treats two NULLs as equal, so an owner who deleted two channels can hold
-- two rows that differ in nothing else. Those fold in their own row id instead
-- of the channel they no longer have.
UPDATE `ReminderLog`
SET `dedupKey` = SHA2(CONCAT_WS(':', `ownerId`, `entityType`, `entityId`,
  DATE_FORMAT(`scheduledFor`, '%Y-%m-%d'), `offsetDays`,
  COALESCE(`channelId`, CONCAT('row:', `id`))), 256);

-- The default existed only to admit the backfill. The schema declares none, so
-- the database must not go on quietly labelling a row the application forgot
-- to: an explicit policy is the invariant this migration introduces.
ALTER TABLE `ReminderLog`
  MODIFY `schedulingPolicy` VARCHAR(32) NOT NULL,
  MODIFY `dedupKey` VARCHAR(64) NOT NULL,
  ADD UNIQUE INDEX `ReminderLog_dedup_key` (`ownerId`, `dedupKey`);
