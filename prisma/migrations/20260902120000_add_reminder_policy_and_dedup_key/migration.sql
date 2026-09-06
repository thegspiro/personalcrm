ALTER TABLE `ReminderLog`
  ADD COLUMN `schedulingPolicy` VARCHAR(32) NOT NULL DEFAULT 'IMPORTANT_DATE_OFFSET',
  ADD COLUMN `dedupKey` VARCHAR(64) NULL;

-- Every row that exists was written by the important-date policy, which was the
-- only one; the temporary default above labels them all correctly.
--
-- The key is the one the application computes — SHA-256 over the JSON of the
-- same seven fields in the same order, see reminderDedupKey — and has to be
-- byte for byte, not merely unique: the scheduler looks rows up by this key
-- before inserting, so a row keyed any other way is invisible to it, and a
-- pre-upgrade reminder that was cancelled would then be blocked for ever by
-- the old delivery key it still carries. Ids are cuids and dates are plain,
-- so nothing here needs JSON escaping.
UPDATE `ReminderLog`
SET `dedupKey` = SHA2(CONCAT(
  '{"ownerId":"', `ownerId`,
  '","entityType":"', `entityType`,
  '","entityId":"', `entityId`,
  '","policy":"IMPORTANT_DATE_OFFSET',
  '","occurrence":"', DATE_FORMAT(`scheduledFor`, '%Y-%m-%d'),
  '","offsetDays":', `offsetDays`,
  ',"channelId":"', `channelId`, '"}'), 256)
WHERE `channelId` IS NOT NULL;

-- A row whose channel has since been deleted can never be sent again and
-- never matches a runtime key. It still needs a key that is unique per owner,
-- and the delivery key is not quite that: a unique index never treats two
-- NULLs as equal, so an owner who deleted two channels can hold two rows that
-- differ in nothing else. Those fold in their own row id.
UPDATE `ReminderLog`
SET `dedupKey` = SHA2(CONCAT_WS(':', `ownerId`, `entityType`, `entityId`,
  DATE_FORMAT(`scheduledFor`, '%Y-%m-%d'), `offsetDays`, CONCAT('row:', `id`)), 256)
WHERE `channelId` IS NULL;

-- The default existed only to admit the backfill. The schema declares none, so
-- the database must not go on quietly labelling a row the application forgot
-- to: an explicit policy is the invariant this migration introduces.
ALTER TABLE `ReminderLog`
  MODIFY `schedulingPolicy` VARCHAR(32) NOT NULL,
  MODIFY `dedupKey` VARCHAR(64) NOT NULL,
  ADD UNIQUE INDEX `ReminderLog_dedup_key` (`ownerId`, `dedupKey`);
