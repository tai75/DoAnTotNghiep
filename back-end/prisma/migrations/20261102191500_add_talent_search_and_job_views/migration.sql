CREATE TABLE `recruiter_saved_searches` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `recruiter_user_id` INTEGER NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `filters` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `recruiter_saved_searches_recruiter_user_id_created_at_idx` (`recruiter_user_id`, `created_at`),
  CONSTRAINT `recruiter_saved_searches_recruiter_user_id_fkey` FOREIGN KEY (`recruiter_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `talent_invitations` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `candidate_id` INTEGER NOT NULL,
  `recruiter_user_id` INTEGER NOT NULL,
  `job_id` INTEGER NOT NULL,
  `status` ENUM('PENDING', 'ACCEPTED', 'DECLINED') NOT NULL DEFAULT 'PENDING',
  `message` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `responded_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `talent_invitations_candidate_id_recruiter_user_id_job_id_key` (`candidate_id`, `recruiter_user_id`, `job_id`),
  INDEX `talent_invitations_candidate_id_status_idx` (`candidate_id`, `status`),
  CONSTRAINT `talent_invitations_candidate_id_fkey` FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `talent_invitations_recruiter_user_id_fkey` FOREIGN KEY (`recruiter_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `talent_invitations_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `job_views` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `job_id` INTEGER NOT NULL,
  `viewer_key` CHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `job_views_job_id_viewer_key_created_at_idx` (`job_id`, `viewer_key`, `created_at`),
  INDEX `job_views_job_id_created_at_idx` (`job_id`, `created_at`),
  CONSTRAINT `job_views_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
