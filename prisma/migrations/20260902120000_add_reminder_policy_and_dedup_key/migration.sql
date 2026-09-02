ALTER TABLE `ReminderLog`
  ADD COLUMN `schedulingPolicy` VARCHAR(32) NOT NULL DEFAULT 'IMPORTANT_DATE_OFFSET',
  ADD COLUMN `dedupKey` VARCHAR(64) NULL;

-- Preserve shipped ledger rows while giving every one an immutable key.
UPDATE `ReminderLog`
SET `dedupKey` = SHA2(CONCAT_WS(':', `ownerId`, `entityType`, `entityId`,
  DATE_FORMAT(`scheduledFor`, '%Y-%m-%d'), `offsetDays`, COALESCE(`channelId`, 'none')), 256);

ALTER TABLE `ReminderLog`
  MODIFY `dedupKey` VARCHAR(64) NOT NULL,
  ADD UNIQUE INDEX `ReminderLog_dedup_key` (`ownerId`, `dedupKey`);
