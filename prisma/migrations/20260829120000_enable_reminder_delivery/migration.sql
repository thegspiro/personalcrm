-- Preserve the old, pre-delivery ledger rows. New deliveries always have a
-- channel; nullable legacy rows cannot collide under MariaDB unique semantics.
DROP INDEX `ReminderLog_ownerId_entityType_entityId_scheduledFor_key` ON `ReminderLog`;
ALTER TABLE `ReminderLog`
  ADD COLUMN `offsetDays` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `attemptCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `nextAttemptAt` DATETIME(3) NULL,
  MODIFY `sentAt` DATETIME(3) NULL,
  MODIFY `ok` BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX `ReminderLog_ownerId_entityType_entityId_scheduledFor_offsetDays_channelId_key`
  ON `ReminderLog`(`ownerId`, `entityType`, `entityId`, `scheduledFor`, `offsetDays`, `channelId`);
