CREATE TABLE `job_screening_questions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `job_id` INTEGER NOT NULL,
  `type` ENUM('YES_NO', 'NUMBER', 'TEXT', 'SINGLE_CHOICE') NOT NULL,
  `question` VARCHAR(500) NOT NULL,
  `options` JSON NULL,
  `is_required` BOOLEAN NOT NULL DEFAULT false,
  `is_knockout` BOOLEAN NOT NULL DEFAULT false,
  `ideal_answer` TEXT NULL,
  PRIMARY KEY (`id`),
  INDEX `job_screening_questions_job_id_idx` (`job_id`),
  CONSTRAINT `job_screening_questions_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `application_answers` (
  `application_id` INTEGER NOT NULL,
  `question_id` INTEGER NOT NULL,
  `answer` TEXT NOT NULL,
  PRIMARY KEY (`application_id`, `question_id`),
  INDEX `application_answers_question_id_idx` (`question_id`),
  CONSTRAINT `application_answers_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `application_answers_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `job_screening_questions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
