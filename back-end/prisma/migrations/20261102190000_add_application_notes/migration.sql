CREATE TABLE `application_notes` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `application_id` INTEGER NOT NULL,
  `author_user_id` INTEGER NOT NULL,
  `content` TEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `application_notes_application_id_created_at_idx` (`application_id`, `created_at`),
  CONSTRAINT `application_notes_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `application_notes_author_user_id_fkey` FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
