CREATE TABLE `resume_job_analyses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `resume_id` INTEGER NOT NULL,
    `job_id` INTEGER NOT NULL,
    `fit_score` DECIMAL(5, 2) NOT NULL,
    `missing_keywords` JSON NOT NULL,
    `strengths` JSON NOT NULL,
    `suggestions` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `resume_job_analyses_resume_id_job_id_key`(`resume_id`, `job_id`),
    INDEX `resume_job_analyses_job_id_idx`(`job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `resume_job_analyses`
    ADD CONSTRAINT `resume_job_analyses_resume_id_fkey` FOREIGN KEY (`resume_id`) REFERENCES `candidate_resumes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `resume_job_analyses_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
