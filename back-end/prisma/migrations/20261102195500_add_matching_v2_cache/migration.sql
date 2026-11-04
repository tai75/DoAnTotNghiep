CREATE TABLE `embedding_cache` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `content_hash` CHAR(64) NOT NULL,
    `vector` JSON NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `embedding_cache_content_hash_key`(`content_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `match_scores_v2` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidate_id` INTEGER NOT NULL,
    `job_id` INTEGER NOT NULL,
    `score` DECIMAL(5, 2) NOT NULL,
    `skill_score` DECIMAL(5, 2) NOT NULL,
    `experience_score` DECIMAL(5, 2) NOT NULL,
    `position_score` DECIMAL(5, 2) NOT NULL,
    `location_score` DECIMAL(5, 2) NOT NULL,
    `salary_score` DECIMAL(5, 2) NOT NULL,
    `employment_score` DECIMAL(5, 2) NOT NULL,
    `semantic_score` DECIMAL(5, 2) NOT NULL,
    `matched_skills` JSON NULL,
    `missing_skills` JSON NULL,
    `computed_at` DATETIME(3) NOT NULL,
    `algorithm_version` VARCHAR(50) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `match_scores_v2_candidate_id_job_id_key`(`candidate_id`, `job_id`),
    INDEX `match_scores_v2_job_id_score_idx`(`job_id`, `score`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `match_scores_v2`
    ADD CONSTRAINT `match_scores_v2_candidate_id_fkey` FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `match_scores_v2_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
