ALTER TABLE `candidates`
  ADD COLUMN `desired_position` VARCHAR(180) NULL,
  ADD COLUMN `desired_salary` DECIMAL(15, 2) NULL,
  ADD COLUMN `desired_location` VARCHAR(150) NULL,
  ADD COLUMN `desired_employment_type` ENUM('FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE', 'HYBRID') NULL,
  ADD COLUMN `is_searchable` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `applications`
  ADD COLUMN `resume_id` INT NULL,
  ADD COLUMN `resume_path_snapshot` VARCHAR(500) NULL;

CREATE TABLE `candidate_educations` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `candidate_id` INT NOT NULL,
  `school` VARCHAR(255) NOT NULL,
  `major` VARCHAR(180) NULL,
  `degree` VARCHAR(120) NULL,
  `from_date` DATETIME(3) NULL,
  `to_date` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `candidate_educations_candidate_id_idx` (`candidate_id`),
  CONSTRAINT `candidate_educations_candidate_id_fkey`
    FOREIGN KEY (`candidate_id`) REFERENCES `candidates` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `candidate_experiences` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `candidate_id` INT NOT NULL,
  `company` VARCHAR(180) NOT NULL,
  `title` VARCHAR(180) NOT NULL,
  `description` TEXT NULL,
  `from_date` DATETIME(3) NULL,
  `to_date` DATETIME(3) NULL,
  `is_current` BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (`id`),
  INDEX `candidate_experiences_candidate_id_idx` (`candidate_id`),
  CONSTRAINT `candidate_experiences_candidate_id_fkey`
    FOREIGN KEY (`candidate_id`) REFERENCES `candidates` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `candidate_projects` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `candidate_id` INT NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `description` TEXT NULL,
  `link` VARCHAR(500) NULL,
  `technologies` JSON NULL,
  PRIMARY KEY (`id`),
  INDEX `candidate_projects_candidate_id_idx` (`candidate_id`),
  CONSTRAINT `candidate_projects_candidate_id_fkey`
    FOREIGN KEY (`candidate_id`) REFERENCES `candidates` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `candidate_resumes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `candidate_id` INT NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `path` VARCHAR(500) NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `size` INT NOT NULL,
  `is_default` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `candidate_resumes_candidate_id_is_default_idx` (`candidate_id`, `is_default`),
  CONSTRAINT `candidate_resumes_candidate_id_fkey`
    FOREIGN KEY (`candidate_id`) REFERENCES `candidates` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `saved_jobs` (
  `candidate_id` INT NOT NULL,
  `job_id` INT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`candidate_id`, `job_id`),
  INDEX `saved_jobs_job_id_idx` (`job_id`),
  CONSTRAINT `saved_jobs_candidate_id_fkey`
    FOREIGN KEY (`candidate_id`) REFERENCES `candidates` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `saved_jobs_job_id_fkey`
    FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notifications` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `type` VARCHAR(80) NOT NULL,
  `title` VARCHAR(180) NOT NULL,
  `content` TEXT NOT NULL,
  `link` VARCHAR(500) NULL,
  `is_read` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `notifications_user_id_is_read_created_at_idx` (`user_id`, `is_read`, `created_at`),
  CONSTRAINT `notifications_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `password_reset_tokens` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `used_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `password_reset_tokens_token_hash_key` (`token_hash`),
  INDEX `password_reset_tokens_user_id_expires_at_idx` (`user_id`, `expires_at`),
  INDEX `password_reset_tokens_expires_at_used_at_idx` (`expires_at`, `used_at`),
  CONSTRAINT `password_reset_tokens_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `applications`
  ADD CONSTRAINT `applications_resume_id_fkey`
    FOREIGN KEY (`resume_id`) REFERENCES `candidate_resumes` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `jobs_deadline_idx` ON `jobs` (`deadline`);
CREATE INDEX `jobs_employment_type_idx` ON `jobs` (`employment_type`);
