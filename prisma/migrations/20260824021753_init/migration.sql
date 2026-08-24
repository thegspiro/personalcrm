-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `role` ENUM('ADMIN', 'MEMBER') NOT NULL DEFAULT 'MEMBER',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userAgent` VARCHAR(255) NULL,
    `ip` VARCHAR(64) NULL,

    UNIQUE INDEX `Session_tokenHash_key`(`tokenHash`),
    INDEX `Session_userId_idx`(`userId`),
    INDEX `Session_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserPreference` (
    `userId` VARCHAR(191) NOT NULL,
    `theme` VARCHAR(16) NOT NULL DEFAULT 'system',
    `accent` VARCHAR(24) NOT NULL DEFAULT 'violet',
    `density` VARCHAR(16) NOT NULL DEFAULT 'comfortable',
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
    `weekStartsOn` INTEGER NOT NULL DEFAULT 0,
    `defaultCadenceDays` INTEGER NULL,
    `digestHour` INTEGER NOT NULL DEFAULT 8,
    `digestEnabled` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppSetting` (
    `key` VARCHAR(96) NOT NULL,
    `value` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaxonomyTerm` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `kind` ENUM('CONTACT_CATEGORY', 'CONTACT_METHOD_TYPE', 'INTERACTION_TYPE', 'FACT_CATEGORY', 'DATE_TYPE', 'RELATIONSHIP_TYPE', 'DATING_STAGE', 'DATE_ACTIVITY_TYPE', 'MEETING_SOURCE', 'GIFT_OCCASION') NOT NULL,
    `slug` VARCHAR(96) NOT NULL,
    `label` VARCHAR(96) NOT NULL,
    `icon` VARCHAR(64) NULL,
    `color` VARCHAR(24) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `inverseTermId` VARCHAR(191) NULL,

    INDEX `TaxonomyTerm_ownerId_kind_sortOrder_idx`(`ownerId`, `kind`, `sortOrder`),
    INDEX `TaxonomyTerm_inverseTermId_idx`(`inverseTermId`),
    UNIQUE INDEX `TaxonomyTerm_ownerId_kind_slug_key`(`ownerId`, `kind`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contact` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(120) NOT NULL,
    `lastName` VARCHAR(120) NULL,
    `nickname` VARCHAR(120) NULL,
    `pronouns` VARCHAR(48) NULL,
    `avatarPath` VARCHAR(255) NULL,
    `categoryId` VARCHAR(191) NULL,
    `birthDate` DATE NULL,
    `birthYearKnown` BOOLEAN NOT NULL DEFAULT true,
    `howWeMet` TEXT NULL,
    `whereWeMet` VARCHAR(191) NULL,
    `metOn` DATE NULL,
    `meetingSourceId` VARCHAR(191) NULL,
    `occupation` VARCHAR(191) NULL,
    `employer` VARCHAR(191) NULL,
    `city` VARCHAR(120) NULL,
    `region` VARCHAR(120) NULL,
    `country` VARCHAR(120) NULL,
    `timezone` VARCHAR(64) NULL,
    `summary` TEXT NULL,
    `isFavorite` BOOLEAN NOT NULL DEFAULT false,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `isRomantic` BOOLEAN NOT NULL DEFAULT false,
    `cadenceDays` INTEGER NULL,
    `snoozedUntil` DATETIME(3) NULL,
    `lastInteractionAt` DATETIME(3) NULL,
    `nextTouchAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Contact_ownerId_isArchived_lastName_idx`(`ownerId`, `isArchived`, `lastName`),
    INDEX `Contact_ownerId_isArchived_firstName_idx`(`ownerId`, `isArchived`, `firstName`),
    INDEX `Contact_ownerId_nextTouchAt_idx`(`ownerId`, `nextTouchAt`),
    INDEX `Contact_ownerId_isRomantic_isArchived_idx`(`ownerId`, `isRomantic`, `isArchived`),
    INDEX `Contact_categoryId_idx`(`categoryId`),
    INDEX `Contact_meetingSourceId_idx`(`meetingSourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContactMethod` (
    `id` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `typeId` VARCHAR(191) NULL,
    `value` VARCHAR(255) NOT NULL,
    `label` VARCHAR(96) NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `ContactMethod_contactId_idx`(`contactId`),
    INDEX `ContactMethod_typeId_idx`(`typeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Address` (
    `id` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(96) NULL,
    `line1` VARCHAR(191) NULL,
    `line2` VARCHAR(191) NULL,
    `city` VARCHAR(120) NULL,
    `region` VARCHAR(120) NULL,
    `postalCode` VARCHAR(32) NULL,
    `country` VARCHAR(120) NULL,
    `notes` TEXT NULL,

    INDEX `Address_contactId_idx`(`contactId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tag` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(96) NOT NULL,
    `slug` VARCHAR(96) NOT NULL,
    `color` VARCHAR(24) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Tag_ownerId_name_idx`(`ownerId`, `name`),
    UNIQUE INDEX `Tag_ownerId_slug_key`(`ownerId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContactTag` (
    `contactId` VARCHAR(191) NOT NULL,
    `tagId` VARCHAR(191) NOT NULL,

    INDEX `ContactTag_tagId_idx`(`tagId`),
    PRIMARY KEY (`contactId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Relationship` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `fromContactId` VARCHAR(191) NOT NULL,
    `toContactId` VARCHAR(191) NOT NULL,
    `typeId` VARCHAR(191) NOT NULL,
    `notes` TEXT NULL,
    `pairId` VARCHAR(32) NOT NULL,

    INDEX `Relationship_ownerId_idx`(`ownerId`),
    INDEX `Relationship_toContactId_idx`(`toContactId`),
    INDEX `Relationship_typeId_idx`(`typeId`),
    INDEX `Relationship_pairId_idx`(`pairId`),
    UNIQUE INDEX `Relationship_fromContactId_toContactId_typeId_key`(`fromContactId`, `toContactId`, `typeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Interaction` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `typeId` VARCHAR(191) NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `durationMinutes` INTEGER NULL,
    `title` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `sentiment` INTEGER NULL,
    `location` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Interaction_ownerId_occurredAt_idx`(`ownerId`, `occurredAt`),
    INDEX `Interaction_typeId_idx`(`typeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InteractionParticipant` (
    `interactionId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,

    INDEX `InteractionParticipant_contactId_idx`(`contactId`),
    PRIMARY KEY (`interactionId`, `contactId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Fact` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NULL,
    `content` TEXT NOT NULL,
    `importance` INTEGER NOT NULL DEFAULT 1,
    `sourceInteractionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Fact_contactId_importance_idx`(`contactId`, `importance`),
    INDEX `Fact_ownerId_idx`(`ownerId`),
    INDEX `Fact_categoryId_idx`(`categoryId`),
    INDEX `Fact_sourceInteractionId_idx`(`sourceInteractionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImportantDate` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `typeId` VARCHAR(191) NULL,
    `label` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `yearKnown` BOOLEAN NOT NULL DEFAULT true,
    `recurrence` ENUM('NONE', 'ANNUAL', 'MONTHLY') NOT NULL DEFAULT 'ANNUAL',
    `reminderDaysBefore` JSON NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ImportantDate_contactId_idx`(`contactId`),
    INDEX `ImportantDate_ownerId_date_idx`(`ownerId`, `date`),
    INDEX `ImportantDate_typeId_idx`(`typeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Idea` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NULL,
    `content` TEXT NOT NULL,
    `status` ENUM('OPEN', 'USED', 'ARCHIVED') NOT NULL DEFAULT 'OPEN',
    `usedAt` DATETIME(3) NULL,
    `usedInInteractionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Idea_ownerId_status_idx`(`ownerId`, `status`),
    INDEX `Idea_contactId_status_idx`(`contactId`, `status`),
    INDEX `Idea_usedInInteractionId_idx`(`usedInInteractionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Task` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `notes` TEXT NULL,
    `dueDate` DATE NULL,
    `completedAt` DATETIME(3) NULL,
    `priority` ENUM('LOW', 'NORMAL', 'HIGH') NOT NULL DEFAULT 'NORMAL',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Task_ownerId_completedAt_dueDate_idx`(`ownerId`, `completedAt`, `dueDate`),
    INDEX `Task_contactId_idx`(`contactId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Gift` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `url` VARCHAR(500) NULL,
    `priceCents` INTEGER NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'USD',
    `occasionId` VARCHAR(191) NULL,
    `status` ENUM('IDEA', 'RESERVED', 'PURCHASED', 'GIVEN') NOT NULL DEFAULT 'IDEA',
    `direction` ENUM('OUTGOING', 'INCOMING') NOT NULL DEFAULT 'OUTGOING',
    `occurredOn` DATE NULL,
    `rating` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Gift_contactId_status_idx`(`contactId`, `status`),
    INDEX `Gift_ownerId_status_idx`(`ownerId`, `status`),
    INDEX `Gift_occasionId_idx`(`occasionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RomanticProfile` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `stageId` VARCHAR(191) NULL,
    `sourceId` VARCHAR(191) NULL,
    `sourceDetail` VARCHAR(191) NULL,
    `matchedOn` DATE NULL,
    `firstDateOn` DATE NULL,
    `endedOn` DATE NULL,
    `endedReason` TEXT NULL,
    `birthYear` INTEGER NULL,
    `heightCm` INTEGER NULL,
    `distanceKm` INTEGER NULL,
    `livingSituation` VARCHAR(191) NULL,
    `relationshipStyle` VARCHAR(96) NULL,
    `wantsKids` ENUM('UNKNOWN', 'WANTS', 'DOES_NOT_WANT', 'OPEN', 'HAS_AND_DONE') NOT NULL DEFAULT 'UNKNOWN',
    `hasKids` BOOLEAN NULL,
    `religion` VARCHAR(96) NULL,
    `politics` VARCHAR(96) NULL,
    `smoking` VARCHAR(48) NULL,
    `drinking` VARCHAR(48) NULL,
    `loveLanguages` JSON NULL,
    `mbti` VARCHAR(8) NULL,
    `enneagram` VARCHAR(16) NULL,
    `exclusive` BOOLEAN NOT NULL DEFAULT false,
    `overallRating` INTEGER NULL,
    `chemistryScore` INTEGER NULL,
    `profileLinks` JSON NULL,
    `privateNotes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RomanticProfile_contactId_key`(`contactId`),
    INDEX `RomanticProfile_ownerId_stageId_idx`(`ownerId`, `stageId`),
    INDEX `RomanticProfile_sourceId_idx`(`sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DateEntry` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `interactionId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NULL,
    `activityTypeId` VARCHAR(191) NULL,
    `venue` VARCHAR(191) NULL,
    `city` VARCHAR(120) NULL,
    `whoPaid` ENUM('UNSPECIFIED', 'ME', 'THEM', 'SPLIT') NOT NULL DEFAULT 'UNSPECIFIED',
    `costCents` INTEGER NULL,
    `rating` INTEGER NULL,
    `chemistry` INTEGER NULL,
    `conversationQuality` INTEGER NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DateEntry_interactionId_key`(`interactionId`),
    INDEX `DateEntry_contactId_sequence_idx`(`contactId`, `sequence`),
    INDEX `DateEntry_ownerId_idx`(`ownerId`),
    INDEX `DateEntry_activityTypeId_idx`(`activityTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Flag` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `kind` ENUM('GREEN', 'RED', 'DEALBREAKER') NOT NULL,
    `text` TEXT NOT NULL,
    `severity` INTEGER NOT NULL DEFAULT 2,
    `noticedOn` DATE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Flag_contactId_kind_idx`(`contactId`, `kind`),
    INDEX `Flag_ownerId_kind_idx`(`ownerId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomFieldDefinition` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `entity` ENUM('CONTACT', 'ROMANTIC', 'INTERACTION', 'DATE_ENTRY') NOT NULL,
    `key` VARCHAR(96) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `description` VARCHAR(255) NULL,
    `fieldType` ENUM('TEXT', 'LONGTEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'MULTISELECT', 'URL') NOT NULL,
    `options` JSON NULL,
    `appliesToCategoryIds` JSON NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CustomFieldDefinition_ownerId_entity_sortOrder_idx`(`ownerId`, `entity`, `sortOrder`),
    UNIQUE INDEX `CustomFieldDefinition_ownerId_entity_key_key`(`ownerId`, `entity`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomFieldValue` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `definitionId` VARCHAR(191) NOT NULL,
    `entityType` ENUM('CONTACT', 'ROMANTIC', 'INTERACTION', 'DATE_ENTRY') NOT NULL,
    `entityId` VARCHAR(64) NOT NULL,
    `value` JSON NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CustomFieldValue_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `CustomFieldValue_ownerId_idx`(`ownerId`),
    UNIQUE INDEX `CustomFieldValue_definitionId_entityId_key`(`definitionId`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DashboardLayout` (
    `userId` VARCHAR(191) NOT NULL,
    `widgets` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationChannel` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `kind` ENUM('EMAIL', 'NTFY', 'GOTIFY', 'DISCORD', 'WEBHOOK') NOT NULL,
    `name` VARCHAR(96) NOT NULL,
    `config` JSON NOT NULL,
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `NotificationChannel_ownerId_isEnabled_idx`(`ownerId`, `isEnabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReminderLog` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `entityType` ENUM('IMPORTANT_DATE', 'CADENCE', 'TASK', 'DIGEST') NOT NULL,
    `entityId` VARCHAR(64) NOT NULL,
    `scheduledFor` DATE NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `channelId` VARCHAR(191) NULL,
    `ok` BOOLEAN NOT NULL DEFAULT true,
    `error` TEXT NULL,

    INDEX `ReminderLog_ownerId_sentAt_idx`(`ownerId`, `sentAt`),
    INDEX `ReminderLog_channelId_idx`(`channelId`),
    UNIQUE INDEX `ReminderLog_ownerId_entityType_entityId_scheduledFor_key`(`ownerId`, `entityType`, `entityId`, `scheduledFor`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserPreference` ADD CONSTRAINT `UserPreference_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaxonomyTerm` ADD CONSTRAINT `TaxonomyTerm_inverseTermId_fkey` FOREIGN KEY (`inverseTermId`) REFERENCES `TaxonomyTerm`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaxonomyTerm` ADD CONSTRAINT `TaxonomyTerm_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contact` ADD CONSTRAINT `Contact_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contact` ADD CONSTRAINT `Contact_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `TaxonomyTerm`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contact` ADD CONSTRAINT `Contact_meetingSourceId_fkey` FOREIGN KEY (`meetingSourceId`) REFERENCES `TaxonomyTerm`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContactMethod` ADD CONSTRAINT `ContactMethod_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContactMethod` ADD CONSTRAINT `ContactMethod_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `TaxonomyTerm`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Address` ADD CONSTRAINT `Address_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tag` ADD CONSTRAINT `Tag_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContactTag` ADD CONSTRAINT `ContactTag_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContactTag` ADD CONSTRAINT `ContactTag_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `Tag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Relationship` ADD CONSTRAINT `Relationship_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Relationship` ADD CONSTRAINT `Relationship_fromContactId_fkey` FOREIGN KEY (`fromContactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Relationship` ADD CONSTRAINT `Relationship_toContactId_fkey` FOREIGN KEY (`toContactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Relationship` ADD CONSTRAINT `Relationship_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `TaxonomyTerm`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Interaction` ADD CONSTRAINT `Interaction_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Interaction` ADD CONSTRAINT `Interaction_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `TaxonomyTerm`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InteractionParticipant` ADD CONSTRAINT `InteractionParticipant_interactionId_fkey` FOREIGN KEY (`interactionId`) REFERENCES `Interaction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InteractionParticipant` ADD CONSTRAINT `InteractionParticipant_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Fact` ADD CONSTRAINT `Fact_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Fact` ADD CONSTRAINT `Fact_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Fact` ADD CONSTRAINT `Fact_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `TaxonomyTerm`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Fact` ADD CONSTRAINT `Fact_sourceInteractionId_fkey` FOREIGN KEY (`sourceInteractionId`) REFERENCES `Interaction`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportantDate` ADD CONSTRAINT `ImportantDate_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportantDate` ADD CONSTRAINT `ImportantDate_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportantDate` ADD CONSTRAINT `ImportantDate_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `TaxonomyTerm`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Idea` ADD CONSTRAINT `Idea_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Idea` ADD CONSTRAINT `Idea_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Idea` ADD CONSTRAINT `Idea_usedInInteractionId_fkey` FOREIGN KEY (`usedInInteractionId`) REFERENCES `Interaction`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Gift` ADD CONSTRAINT `Gift_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Gift` ADD CONSTRAINT `Gift_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Gift` ADD CONSTRAINT `Gift_occasionId_fkey` FOREIGN KEY (`occasionId`) REFERENCES `TaxonomyTerm`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RomanticProfile` ADD CONSTRAINT `RomanticProfile_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RomanticProfile` ADD CONSTRAINT `RomanticProfile_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RomanticProfile` ADD CONSTRAINT `RomanticProfile_stageId_fkey` FOREIGN KEY (`stageId`) REFERENCES `TaxonomyTerm`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RomanticProfile` ADD CONSTRAINT `RomanticProfile_sourceId_fkey` FOREIGN KEY (`sourceId`) REFERENCES `TaxonomyTerm`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DateEntry` ADD CONSTRAINT `DateEntry_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DateEntry` ADD CONSTRAINT `DateEntry_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DateEntry` ADD CONSTRAINT `DateEntry_interactionId_fkey` FOREIGN KEY (`interactionId`) REFERENCES `Interaction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DateEntry` ADD CONSTRAINT `DateEntry_activityTypeId_fkey` FOREIGN KEY (`activityTypeId`) REFERENCES `TaxonomyTerm`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Flag` ADD CONSTRAINT `Flag_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Flag` ADD CONSTRAINT `Flag_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomFieldDefinition` ADD CONSTRAINT `CustomFieldDefinition_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomFieldValue` ADD CONSTRAINT `CustomFieldValue_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomFieldValue` ADD CONSTRAINT `CustomFieldValue_definitionId_fkey` FOREIGN KEY (`definitionId`) REFERENCES `CustomFieldDefinition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DashboardLayout` ADD CONSTRAINT `DashboardLayout_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationChannel` ADD CONSTRAINT `NotificationChannel_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReminderLog` ADD CONSTRAINT `ReminderLog_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReminderLog` ADD CONSTRAINT `ReminderLog_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `NotificationChannel`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
