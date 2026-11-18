CREATE TABLE `auth_sessions` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` INTEGER NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `auth_sessions_user_id_revoked_at_idx` (`user_id`, `revoked_at`),
  INDEX `auth_sessions_expires_at_revoked_at_idx` (`expires_at`, `revoked_at`),
  CONSTRAINT `auth_sessions_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `refresh_tokens`
  ADD COLUMN `session_id` VARCHAR(36) NULL;

CREATE INDEX `refresh_tokens_session_id_revoked_at_idx`
  ON `refresh_tokens` (`session_id`, `revoked_at`);

ALTER TABLE `refresh_tokens`
  ADD CONSTRAINT `refresh_tokens_session_id_fkey`
  FOREIGN KEY (`session_id`) REFERENCES `auth_sessions` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
