-- Reconcile the incremental migration result with prisma/schema.prisma.
-- This is additive/fix-forward so the existing 14 migrations remain immutable.

ALTER TABLE `application_answers`
  DROP FOREIGN KEY `application_answers_application_id_fkey`,
  DROP FOREIGN KEY `application_answers_question_id_fkey`,
  DROP INDEX `application_answers_question_id_idx`,
  CHANGE COLUMN `application_id` `applicationId` INTEGER NOT NULL,
  CHANGE COLUMN `question_id` `questionId` INTEGER NOT NULL,
  ADD INDEX `application_answers_questionId_idx` (`questionId`),
  ADD CONSTRAINT `application_answers_applicationId_fkey`
    FOREIGN KEY (`applicationId`) REFERENCES `applications` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `application_answers_questionId_fkey`
    FOREIGN KEY (`questionId`) REFERENCES `job_screening_questions` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `jobs`
  DROP INDEX `jobs_status_created_at_idx`,
  ADD INDEX `jobs_status_idx` (`status`),
  ADD INDEX `jobs_created_at_idx` (`created_at`);

ALTER TABLE `match_scores`
  MODIFY `employment_score` DECIMAL(5, 2) NOT NULL;

ALTER TABLE `resume_job_analyses`
  ADD COLUMN `candidateId` INTEGER NULL,
  ADD CONSTRAINT `resume_job_analyses_candidateId_fkey`
    FOREIGN KEY (`candidateId`) REFERENCES `candidates` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
