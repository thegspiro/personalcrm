-- Sign-in throttling moved into the process that serves the request, so this
-- table has no reader left. It only ever held ephemeral attempt counters: no
-- user content, nothing referenced from anywhere else, and nothing whose loss
-- is felt beyond resetting whatever backoff was in flight at the moment of the
-- upgrade.
--
-- Why it went: both halves of its key came from whoever was knocking, which
-- made it a store an attacker chose the size of. Bounding it meant dropping
-- records, and dropping records meant the throttle could be switched off by
-- filling it. A fixed-size structure in memory has neither problem.
--
-- IF EXISTS so this is a no-op against a database that never ran the migration
-- which created it. Rolling back means restoring that migration's CREATE TABLE
-- (20260901120000_add_login_attempt_throttle); no data needs to come with it.

-- DropTable
DROP TABLE IF EXISTS `LoginAttempt`;
