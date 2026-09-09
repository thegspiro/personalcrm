-- Delivery health for a notification channel.
--
-- Purely additive and every column nullable, so existing rows are valid as they
-- stand and nothing is backfilled: a channel that has never been paused reads
-- as never paused, and a ledger row written before this migration simply has no
-- attempt time. Nothing is dropped and no existing value is re-expressed.

-- AlterTable
ALTER TABLE `NotificationChannel` ADD COLUMN `lastProbeAt` DATETIME(3) NULL,
    ADD COLUMN `pauseReason` TEXT NULL,
    ADD COLUMN `pausedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `ReminderLog` ADD COLUMN `lastAttemptAt` DATETIME(3) NULL;
