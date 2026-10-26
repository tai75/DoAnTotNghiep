CREATE TABLE `refresh_tokens` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `refresh_tokens_token_hash_key` (`token_hash`),
  INDEX `refresh_tokens_user_id_expires_at_idx` (`user_id`, `expires_at`),
  INDEX `refresh_tokens_expires_at_revoked_at_idx` (`expires_at`, `revoked_at`),
  CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
