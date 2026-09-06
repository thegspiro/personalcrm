-- Reminders for a plan you have arranged.
--
-- Two additive changes, neither of which re-expresses anything stored:
--
-- 1. `Plan.reminderDaysBefore`, the same JSON shape as
--    `ImportantDate.reminderDaysBefore`. Nullable, and null means *no
--    reminders* rather than "the account default" — the opposite of what null
--    means for an important date, and deliberately so. An arrangement is not
--    something the app should start announcing unasked, and reading null as a
--    default would have every plan already sitting at PLANNED send two
--    reminders on the first hourly pass after this upgrade.
--
-- 2. `PLAN` appended to `ReminderEntity`. Appended, not reordered: MySQL stores
--    an enum by its position, so inserting a value in the middle would silently
--    change the meaning of every stored `ReminderLog.entityType`.
--
-- Nothing to backfill, and no existing row changes meaning.
--
-- Rollback:
--   ALTER TABLE `Plan` DROP COLUMN `reminderDaysBefore`;
--   ALTER TABLE `ReminderLog` MODIFY `entityType` ENUM('IMPORTANT_DATE', 'CADENCE', 'TASK', 'DIGEST') NOT NULL;
--   -- the second only after no row holds 'PLAN'.
ALTER TABLE `Plan`
  ADD COLUMN `reminderDaysBefore` JSON NULL;

ALTER TABLE `ReminderLog`
  MODIFY `entityType` ENUM('IMPORTANT_DATE', 'CADENCE', 'TASK', 'DIGEST', 'PLAN') NOT NULL;
