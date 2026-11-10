ALTER TABLE `companies`
  ADD COLUMN `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN `status_reason` TEXT NULL,
  ADD COLUMN `status_changed_at` DATETIME(3) NULL,
  ADD INDEX `companies_status_created_at_idx` (`status`, `created_at`);

CREATE TABLE `reports` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `reporter_user_id` INTEGER NOT NULL,
  `resolved_by_user_id` INTEGER NULL,
  `target_type` ENUM('JOB', 'COMPANY') NOT NULL,
  `job_id` INTEGER NULL,
  `company_id` INTEGER NULL,
  `reason` ENUM('SPAM', 'MISLEADING', 'DISCRIMINATION', 'FRAUD', 'OTHER') NOT NULL,
  `description` TEXT NULL,
  `status` ENUM('PENDING', 'REVIEWING', 'RESOLVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `resolution_note` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `resolved_at` DATETIME(3) NULL,
  INDEX `reports_status_created_at_idx` (`status`, `created_at`),
  INDEX `reports_target_type_job_id_company_id_idx` (`target_type`, `job_id`, `company_id`),
  INDEX `reports_reporter_user_id_created_at_idx` (`reporter_user_id`, `created_at`),
  CONSTRAINT `reports_reporter_user_id_fkey` FOREIGN KEY (`reporter_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `reports_resolved_by_user_id_fkey` FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `reports_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `reports_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
