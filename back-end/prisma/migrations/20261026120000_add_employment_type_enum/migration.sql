UPDATE `jobs`
SET `employment_type` = NULL
WHERE `employment_type` IS NOT NULL
  AND `employment_type` NOT IN ('FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE', 'HYBRID');

-- AlterTable
ALTER TABLE `jobs`
  MODIFY `employment_type` ENUM('FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE', 'HYBRID') NULL;
