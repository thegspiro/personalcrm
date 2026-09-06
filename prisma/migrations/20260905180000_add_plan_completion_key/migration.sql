-- Finishing a shared ("Anyone") idea with somebody writes a completed copy and
-- leaves the original open, so unlike the in-place path there is no row whose
-- status can be claimed. Without a key, a second tab or a replayed POST writes
-- a second finished copy and a second timeline entry.
--
-- Purely additive: one nullable column and one unique index. No existing column
-- is re-expressed, so there is nothing to backfill before a drop, and every
-- stored plan keeps its meaning — the column is null on all of them, and both
-- MySQL and MariaDB allow unlimited NULLs under a unique index.
--
-- The key is derived on the server as `<sourcePlanId>:<contactId>:<local day>`,
-- not minted by the client: a client token would only stop a literal replay,
-- because two tabs would mint two of them.
--
-- Rollback:
--   DROP INDEX `Plan_ownerId_completionKey_key` ON `Plan`;
--   ALTER TABLE `Plan` DROP COLUMN `completionKey`;
ALTER TABLE `Plan`
  ADD COLUMN `completionKey` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `Plan_ownerId_completionKey_key` ON `Plan`(`ownerId`, `completionKey`);
