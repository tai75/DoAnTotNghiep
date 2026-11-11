ALTER TABLE `ai_consents`
    ADD COLUMN `withdrawal_requested_at` DATETIME(3) NULL,
    ADD COLUMN `withdrawal_completed_at` DATETIME(3) NULL,
    ADD INDEX `ai_consents_user_id_withdrawal_requested_at_idx`(`user_id`, `withdrawal_requested_at`);

CREATE TABLE `ai_transmission_permits` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_id` CHAR(36) NOT NULL,
    `actor_user_id` INTEGER NULL,
    `scope` ENUM('RESUME_IMPORT', 'RESUME_JOB_ANALYSIS', 'MATCHING_EXPLANATION', 'SEMANTIC_MATCHING', 'AI_CHAT', 'JOB_DESCRIPTION', 'RECRUITER_AI_DISCOVERY') NOT NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'FAILED', 'TIMED_OUT_UNCONFIRMED', 'ORPHANED_UNCONFIRMED') NOT NULL DEFAULT 'PENDING',
    `provider` VARCHAR(80) NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `operation` VARCHAR(80) NOT NULL,
    `input_digest` CHAR(64) NOT NULL,
    `deadline_at` DATETIME(3) NOT NULL,
    `activated_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `cancel_requested_at` DATETIME(3) NULL,
    `lease_owner` VARCHAR(100) NULL,
    `lease_token` CHAR(36) NULL,
    `lease_expires_at` DATETIME(3) NULL,
    `error_code` VARCHAR(80) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `ai_transmission_permits_request_id_key`(`request_id`),
    INDEX `ai_transmission_permits_status_deadline_at_idx`(`status`, `deadline_at`),
    INDEX `ai_transmission_permits_actor_user_id_created_at_idx`(`actor_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_permit_consents` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `permit_id` INTEGER NOT NULL,
    `consent_id` INTEGER NULL,
    `data_subject_user_id` INTEGER NULL,
    `scope` ENUM('RESUME_IMPORT', 'RESUME_JOB_ANALYSIS', 'MATCHING_EXPLANATION', 'SEMANTIC_MATCHING', 'AI_CHAT', 'JOB_DESCRIPTION', 'RECRUITER_AI_DISCOVERY') NOT NULL,
    `policy_version` VARCHAR(40) NOT NULL,
    `consent_version` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `ai_permit_consents_permit_subject_scope_key`(`permit_id`, `data_subject_user_id`, `scope`),
    INDEX `ai_permit_consents_consent_id_idx`(`consent_id`),
    INDEX `ai_permit_consents_subject_scope_idx`(`data_subject_user_id`, `scope`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_usage_events`
    ADD COLUMN `permit_id` INTEGER NULL,
    ADD UNIQUE INDEX `ai_usage_events_permit_id_key`(`permit_id`);

ALTER TABLE `ai_transmission_permits` ADD CONSTRAINT `ai_transmission_permits_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ai_permit_consents` ADD CONSTRAINT `ai_permit_consents_permit_id_fkey` FOREIGN KEY (`permit_id`) REFERENCES `ai_transmission_permits`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ai_permit_consents` ADD CONSTRAINT `ai_permit_consents_consent_id_fkey` FOREIGN KEY (`consent_id`) REFERENCES `ai_consents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ai_permit_consents` ADD CONSTRAINT `ai_permit_consents_data_subject_user_id_fkey` FOREIGN KEY (`data_subject_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ai_usage_events` ADD CONSTRAINT `ai_usage_events_permit_id_fkey` FOREIGN KEY (`permit_id`) REFERENCES `ai_transmission_permits`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
