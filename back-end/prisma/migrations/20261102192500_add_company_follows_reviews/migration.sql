ALTER TABLE `companies` ADD COLUMN `employee_count` INTEGER NULL, ADD COLUMN `industry` VARCHAR(150) NULL;

CREATE TABLE `company_follows` (
  `candidate_id` INTEGER NOT NULL,
  `company_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`candidate_id`, `company_id`),
  INDEX `company_follows_company_id_idx` (`company_id`),
  CONSTRAINT `company_follows_candidate_id_fkey` FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `company_follows_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `company_reviews` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `company_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `rating` INTEGER NOT NULL,
  `title` VARCHAR(180) NOT NULL,
  `pros` TEXT NOT NULL,
  `cons` TEXT NOT NULL,
  `is_anonymous` BOOLEAN NOT NULL DEFAULT false,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `moderation_note` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `company_reviews_company_id_user_id_key` (`company_id`, `user_id`),
  INDEX `company_reviews_company_id_status_created_at_idx` (`company_id`, `status`, `created_at`),
  CONSTRAINT `company_reviews_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `company_reviews_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
