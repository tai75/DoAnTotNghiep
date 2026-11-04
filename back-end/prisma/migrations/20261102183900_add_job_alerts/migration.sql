CREATE TABLE `job_alerts` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `candidate_id` INTEGER NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `keyword` VARCHAR(180) NULL,
  `location` VARCHAR(150) NULL,
  `employment_type` ENUM('FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE', 'HYBRID') NULL,
  `min_salary` DECIMAL(15, 2) NULL,
  `skill_ids` JSON NOT NULL,
  `frequency` ENUM('INSTANT', 'DAILY', 'WEEKLY') NOT NULL DEFAULT 'DAILY',
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `last_sent_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `job_alerts_candidate_id_is_active_idx` (`candidate_id`, `is_active`),
  CONSTRAINT `job_alerts_candidate_id_fkey` FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
