-- Preserve existing scores while making candidate/job the stable identity.
ALTER TABLE `match_scores`
  ADD COLUMN `candidate_id` INT NULL,
  ADD COLUMN `skill_score` DECIMAL(5, 2) NULL,
  ADD COLUMN `experience_score` DECIMAL(5, 2) NULL,
  ADD COLUMN `position_score` DECIMAL(5, 2) NULL,
  ADD COLUMN `location_score` DECIMAL(5, 2) NULL,
  ADD COLUMN `salary_score` DECIMAL(5, 2) NULL,
  ADD COLUMN `employment_score` DECIMAL(5, 2) NULL,
  ADD COLUMN `computed_at` DATETIME(3) NULL,
  ADD COLUMN `algorithm_version` VARCHAR(50) NULL;

UPDATE `match_scores` AS ms
INNER JOIN `applications` AS a ON a.`id` = ms.`application_id`
SET
  ms.`candidate_id` = a.`candidate_id`,
  ms.`skill_score` = 0,
  ms.`experience_score` = 0,
  ms.`position_score` = 0,
  ms.`location_score` = 0,
  ms.`salary_score` = 0,
  ms.`employment_score` = 0,
  ms.`computed_at` = ms.`updated_at`,
  ms.`algorithm_version` = 'legacy-v1';

ALTER TABLE `match_scores`
  MODIFY `application_id` INT NULL,
  MODIFY `candidate_id` INT NOT NULL,
  MODIFY `skill_score` DECIMAL(5, 2) NOT NULL,
  MODIFY `experience_score` DECIMAL(5, 2) NOT NULL,
  MODIFY `position_score` DECIMAL(5, 2) NOT NULL,
  MODIFY `location_score` DECIMAL(5, 2) NOT NULL,
  MODIFY `salary_score` DECIMAL(5, 2) NOT NULL,
  MODIFY `computed_at` DATETIME(3) NOT NULL,
  MODIFY `algorithm_version` VARCHAR(50) NOT NULL;

ALTER TABLE `match_scores`
  ADD CONSTRAINT `match_scores_candidate_id_fkey`
    FOREIGN KEY (`candidate_id`) REFERENCES `candidates` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `match_scores_score_range_chk`
    CHECK (`score` >= 0 AND `score` <= 100),
  ADD CONSTRAINT `match_scores_skill_score_range_chk`
    CHECK (`skill_score` >= 0 AND `skill_score` <= 100),
  ADD CONSTRAINT `match_scores_experience_score_range_chk`
    CHECK (`experience_score` >= 0 AND `experience_score` <= 100),
  ADD CONSTRAINT `match_scores_position_score_range_chk`
    CHECK (`position_score` >= 0 AND `position_score` <= 100),
  ADD CONSTRAINT `match_scores_location_score_range_chk`
    CHECK (`location_score` >= 0 AND `location_score` <= 100),
  ADD CONSTRAINT `match_scores_salary_score_range_chk`
    CHECK (`salary_score` >= 0 AND `salary_score` <= 100),
  ADD CONSTRAINT `match_scores_employment_score_range_chk`
    CHECK (`employment_score` >= 0 AND `employment_score` <= 100);

ALTER TABLE `match_scores`
  ADD UNIQUE INDEX `match_scores_candidate_id_job_id_key` (`candidate_id`, `job_id`);
