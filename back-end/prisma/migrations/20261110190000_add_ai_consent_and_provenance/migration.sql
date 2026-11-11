CREATE TABLE `ai_consents` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `scope` ENUM('RESUME_IMPORT', 'RESUME_JOB_ANALYSIS', 'MATCHING_EXPLANATION', 'SEMANTIC_MATCHING', 'AI_CHAT', 'JOB_DESCRIPTION', 'RECRUITER_AI_DISCOVERY') NOT NULL,
    `policy_version` VARCHAR(40) NOT NULL,
    `granted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `withdrawn_at` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `ai_consents_user_id_scope_policy_version_key`(`user_id`, `scope`, `policy_version`),
    INDEX `ai_consents_user_id_withdrawn_at_idx`(`user_id`, `withdrawn_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_usage_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actor_user_id` INTEGER NULL,
    `data_subject_user_id` INTEGER NULL,
    `consent_id` INTEGER NULL,
    `scope` ENUM('RESUME_IMPORT', 'RESUME_JOB_ANALYSIS', 'MATCHING_EXPLANATION', 'SEMANTIC_MATCHING', 'AI_CHAT', 'JOB_DESCRIPTION', 'RECRUITER_AI_DISCOVERY') NOT NULL,
    `policy_version` VARCHAR(40) NOT NULL,
    `provider` VARCHAR(80) NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `operation` VARCHAR(80) NOT NULL,
    `outcome` ENUM('STARTED', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'STARTED',
    `input_digest` CHAR(64) NOT NULL,
    `error_code` VARCHAR(80) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    INDEX `ai_usage_events_actor_user_id_created_at_idx`(`actor_user_id`, `created_at`),
    INDEX `ai_usage_events_data_subject_user_id_scope_created_at_idx`(`data_subject_user_id`, `scope`, `created_at`),
    INDEX `ai_usage_events_consent_id_idx`(`consent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `embedding_cache`
    ADD COLUMN `owner_user_id` INTEGER NULL,
    ADD COLUMN `data_subject_user_id` INTEGER NULL,
    ADD COLUMN `ai_consent_id` INTEGER NULL,
    ADD COLUMN `consent_scope` ENUM('RESUME_IMPORT', 'RESUME_JOB_ANALYSIS', 'MATCHING_EXPLANATION', 'SEMANTIC_MATCHING', 'AI_CHAT', 'JOB_DESCRIPTION', 'RECRUITER_AI_DISCOVERY') NULL,
    ADD INDEX `embedding_cache_owner_user_id_idx`(`owner_user_id`),
    ADD INDEX `embedding_cache_data_subject_user_id_consent_scope_idx`(`data_subject_user_id`, `consent_scope`),
    ADD INDEX `embedding_cache_ai_consent_id_idx`(`ai_consent_id`);

ALTER TABLE `resume_job_analyses`
    ADD COLUMN `ai_consent_id` INTEGER NULL,
    ADD INDEX `resume_job_analyses_ai_consent_id_idx`(`ai_consent_id`);

ALTER TABLE `ai_consents` ADD CONSTRAINT `ai_consents_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ai_usage_events` ADD CONSTRAINT `ai_usage_events_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ai_usage_events` ADD CONSTRAINT `ai_usage_events_data_subject_user_id_fkey` FOREIGN KEY (`data_subject_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ai_usage_events` ADD CONSTRAINT `ai_usage_events_consent_id_fkey` FOREIGN KEY (`consent_id`) REFERENCES `ai_consents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `embedding_cache` ADD CONSTRAINT `embedding_cache_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `embedding_cache` ADD CONSTRAINT `embedding_cache_data_subject_user_id_fkey` FOREIGN KEY (`data_subject_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `embedding_cache` ADD CONSTRAINT `embedding_cache_ai_consent_id_fkey` FOREIGN KEY (`ai_consent_id`) REFERENCES `ai_consents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `resume_job_analyses` ADD CONSTRAINT `resume_job_analyses_ai_consent_id_fkey` FOREIGN KEY (`ai_consent_id`) REFERENCES `ai_consents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
