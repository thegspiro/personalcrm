-- Sign-in throttling. Purely additive: a new table, no change to any existing
-- one, so an older image keeps working against a database that has run this.
-- Rolling back is `DROP TABLE `LoginAttempt`;` and costs nothing but the
-- in-flight backoff state.
--
-- IF NOT EXISTS so re-running against a database that already has the table is
-- a no-op rather than an error.

-- CreateTable
CREATE TABLE IF NOT EXISTS `LoginAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(64) NOT NULL,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `failedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LoginAttempt_email_ip_key`(`email`, `ip`),
    INDEX `LoginAttempt_failedAt_idx`(`failedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
