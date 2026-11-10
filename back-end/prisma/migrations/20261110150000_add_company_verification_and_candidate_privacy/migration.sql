-- SEC-01B2B1 migration 20: additive company verification and candidate privacy.
-- Existing candidates are intentionally not updated; only the column default changes.

ALTER TABLE `candidates`
  ALTER COLUMN `is_searchable` SET DEFAULT false;

ALTER TABLE `companies`
  ADD COLUMN `verification_status` ENUM('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN `verified_at` DATETIME(3) NULL,
  ADD COLUMN `verification_source` ENUM('LEGACY_BACKFILL', 'ADMIN_REVIEW') NULL,
  ADD COLUMN `verification_version` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `company_verification_requests` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `company_id` INTEGER NOT NULL,
  `submitted_by_user_id` INTEGER NOT NULL,
  `reviewed_by_user_id` INTEGER NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `company_name` VARCHAR(180) NOT NULL,
  `website` VARCHAR(255) NULL,
  `address` VARCHAR(255) NULL,
  `industry` VARCHAR(150) NULL,
  `description` TEXT NULL,
  `rejection_reason` TEXT NULL,
  `review_note` TEXT NULL,
  `request_key` VARCHAR(100) NOT NULL,
  `company_version` INTEGER NOT NULL,
  `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `company_verification_requests_request_key_key`(`request_key`),
  INDEX `company_verification_requests_status_submitted_at_idx`(`status`, `submitted_at`),
  INDEX `company_verification_requests_company_id_status_idx`(`company_id`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `company_verification_requests`
  ADD CONSTRAINT `company_verification_requests_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `company_verification_requests_submitted_by_user_id_fkey` FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `company_verification_requests_reviewed_by_user_id_fkey` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Conservative legacy backfill: an ACTIVE pre-existing company must have both
-- a recruiter and actual job history. No reviewer is fabricated.
UPDATE `companies` AS `company`
SET `company`.`verification_status` = 'VERIFIED',
    `company`.`verified_at` = CURRENT_TIMESTAMP(3),
    `company`.`verification_source` = 'LEGACY_BACKFILL',
    `company`.`verification_version` = 1
WHERE `company`.`status` = 'ACTIVE'
  AND EXISTS (SELECT 1 FROM `recruiters` AS `recruiter` WHERE `recruiter`.`company_id` = `company`.`id`)
  AND EXISTS (SELECT 1 FROM `jobs` AS `job` WHERE `job`.`company_id` = `company`.`id`);
