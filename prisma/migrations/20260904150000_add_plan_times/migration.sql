-- A pencilled-in plan can now carry a time of day and how long to set aside.
--
-- Purely additive: no existing column is re-expressed, so there is nothing to
-- backfill before a drop and no stored plan changes meaning. Both columns are
-- nullable, and a plan with a day but no time reads exactly as it did before.
--
-- The time is local wall-clock minutes past midnight rather than an instant,
-- so `plannedFor` stays a DATE. Resolving the pair against the account's
-- timezone is `zonedTimeOfDay` in src/lib/dates.ts.
ALTER TABLE `Plan`
  ADD COLUMN `plannedStartMinute` INT NULL,
  ADD COLUMN `plannedDurationMinutes` INT NULL;
