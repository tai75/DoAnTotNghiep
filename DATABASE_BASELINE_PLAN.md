# Database Baseline Plan — Job Connect

Ngày lập kế hoạch: 2026-11-04  
Trạng thái: **Dừng trước thao tác ghi development; chờ xác nhận của người dùng.**

## Mục tiêu và chain được đề xuất

Chuỗi chuẩn gồm:

1. `20261026000000_baseline_07fef94`
2. 14 migration hiện có theo timestamp
3. `20261102201500_reconcile_migration_schema`

Database trắng chạy cả 16 migration. Development hiện có schema cuối chuỗi nên chỉ ghi nhận lịch sử bằng `migrate resolve --applied`; tuyệt đối không replay DDL lên development.

## Gate bắt buộc trước khi ghi development

- [ ] Freeze schema/data writes trong cửa sổ thao tác; dừng backend/worker hoặc chuyển maintenance mode.
- [ ] Review và commit toàn bộ 16 migration. Sau đó không sửa nội dung file; checksum phải ổn định.
- [ ] Tạo full logical backup mới và lưu ngoài repo ở nơi mã hóa/kiểm soát truy cập.
- [ ] Ghi SHA-256, kích thước, thời gian, MySQL version và exit code của dump vào change ticket; không ghi credential.
- [ ] Backup volume chứa CV/logo/uploads cùng recovery point nếu có.
- [ ] Restore dump vào database mới và xác minh exact row counts + schema diff. Drill audit đã pass, nhưng dump audit tạm không được giữ lại.
- [ ] Chạy lại preflight queries bên dưới; mọi query phải trả 0 ở nhóm lỗi.
- [ ] Xác nhận development vẫn không có `_prisma_migrations`. Nếu trạng thái thay đổi, dừng và audit lại.
- [ ] Có phê duyệt rõ ràng trước lệnh `migrate resolve` đầu tiên.

## Backup/restore dự kiến

Dùng MySQL login path hoặc defaults file nằm ngoài repo; không đặt password trong command line/history.

```powershell
mysqldump --login-path=job_connect_dev `
  --single-transaction --routines --triggers --events --hex-blob `
  --set-gtid-purged=OFF --result-file=<SECURE_BACKUP_PATH> <DEV_DATABASE>

Get-FileHash -Algorithm SHA256 <SECURE_BACKUP_PATH>
```

Restore rehearsal vào database mới:

```powershell
mysql --login-path=job_connect_dev -e "CREATE DATABASE <RESTORE_TEST_DATABASE> CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysql --login-path=job_connect_dev <RESTORE_TEST_DATABASE> < <SECURE_BACKUP_PATH>
```

Trong PowerShell thuần, dùng `cmd /c` cho input redirection hoặc MySQL client API; không in password/URL. Không restore đè `job_connect`.

## Preflight development chỉ đọc

```sql
-- History phải chưa tồn tại trước baseline lần đầu.
SELECT COUNT(*) AS migration_table_exists
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = '_prisma_migrations';

-- Không được có giá trị employment type ngoài enum đích.
SELECT id, employment_type
FROM jobs
WHERE employment_type IS NOT NULL
  AND employment_type NOT IN (
    'FULL_TIME', 'PART_TIME', 'INTERNSHIP',
    'CONTRACT', 'REMOTE', 'HYBRID'
  );

-- Mọi match score phải có dữ liệu tương đương backfill migration.
SELECT ms.id
FROM match_scores ms
LEFT JOIN applications a ON a.id = ms.application_id
WHERE ms.candidate_id IS NULL
   OR ms.skill_score IS NULL
   OR ms.experience_score IS NULL
   OR ms.position_score IS NULL
   OR ms.location_score IS NULL
   OR ms.salary_score IS NULL
   OR ms.employment_score IS NULL
   OR ms.computed_at IS NULL
   OR ms.algorithm_version IS NULL
   OR (a.id IS NOT NULL AND ms.candidate_id <> a.candidate_id);

-- Unique key đích không được có duplicate.
SELECT candidate_id, job_id, COUNT(*) AS duplicate_count
FROM match_scores
GROUP BY candidate_id, job_id
HAVING COUNT(*) > 1;
```

Sau preflight, chạy lại hai lệnh chỉ đọc:

```powershell
npx prisma migrate diff `
  --from-schema-datasource prisma/schema.prisma `
  --to-schema-datamodel prisma/schema.prisma `
  --exit-code

npx prisma migrate status
```

Kỳ vọng trước resolve: schema diff rỗng; status liệt kê 16 migration chưa applied.

## Lệnh dự kiến áp dụng cho development

Chạy từ `back-end`. Các lệnh dưới đây **chưa được chạy**. Mỗi lệnh chỉ được chạy sau khi gate hoàn tất và người dùng xác nhận.

```powershell
npx prisma migrate resolve --applied 20261026000000_baseline_07fef94
npx prisma migrate resolve --applied 20261026120000_add_employment_type_enum
npx prisma migrate resolve --applied 20261026123000_add_candidate_profiles_and_interactions
npx prisma migrate resolve --applied 20261026124000_add_job_moderation_note
npx prisma migrate resolve --applied 20261026124500_add_refresh_tokens
npx prisma migrate resolve --applied 20261026125000_redesign_match_scores
npx prisma migrate resolve --applied 20261102164500_add_job_required_years_experience
npx prisma migrate resolve --applied 20261102171500_add_job_screening_questions
npx prisma migrate resolve --applied 20261102183900_add_job_alerts
npx prisma migrate resolve --applied 20261102190000_add_application_notes
npx prisma migrate resolve --applied 20261102191500_add_talent_search_and_job_views
npx prisma migrate resolve --applied 20261102192500_add_company_follows_reviews
npx prisma migrate resolve --applied 20261102194500_add_resume_job_analyses
npx prisma migrate resolve --applied 20261102195500_add_matching_v2_cache
npx prisma migrate resolve --applied 20261102200500_add_conversations_messages
npx prisma migrate resolve --applied 20261102201500_reconcile_migration_schema
```

### Vì sao resolve từng migration

- Baseline được resolve vì 13 bảng nền và `token_version` đã tồn tại.
- Hai data migration chỉ được resolve sau khi preflight chứng minh dữ liệu live đã đạt postcondition của chúng.
- Các migration DDL được resolve vì live DB → datamodel diff rỗng và từng effect đã được review trong bảng audit.
- Migration corrective được resolve vì development tạo bằng `db push` đã có đúng tên cột, index, nullability và foreign key cuối chuỗi.
- Chạy từng lệnh tạo checkpoint rõ ràng và cho phép dừng ngay nếu tên/checksum/filesystem thay đổi. Không dùng loop hoặc bulk script trong lần áp dụng đầu tiên.

Không chạy `prisma migrate deploy` trên development ở bước này.

## Verification sau resolve

```powershell
npx prisma migrate status

npx prisma migrate diff `
  --from-schema-datasource prisma/schema.prisma `
  --to-schema-datamodel prisma/schema.prisma `
  --exit-code
```

Kiểm tra history không có failed/rolled-back row:

```sql
SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
FROM _prisma_migrations
ORDER BY started_at;
```

Tiêu chí pass:

- 16 records, đúng thứ tự và tên.
- Mỗi record có `finished_at`, không có `rolled_back_at`, không có logs lỗi.
- `migrate status` báo up to date.
- `migrate diff --exit-code` trả 0 và không có diff.
- Row counts và data invariant không thay đổi ngoài việc có thêm bảng metadata `_prisma_migrations`.

## Rollback nếu resolve sai hoặc bị gián đoạn

`migrate resolve --applied` chỉ ghi metadata, không chạy migration SQL; tuy vậy Prisma không có thao tác “unapply successful migration” an toàn chung.

1. Dừng backend/worker và không chạy `migrate deploy`.
2. Lưu query result của `_prisma_migrations`, logs và checksum migration để điều tra.
3. Nếu chỉ bị gián đoạn, xác minh các record đã ghi đúng checksum rồi tiếp tục từng migration còn thiếu; không replay migration đã resolve.
4. Nếu có record sai, phương án rollback ưu tiên là restore full backup vào database mới, xác minh, rồi đổi connection theo change approval. Không sửa/xóa history trực tiếp trên database gốc nếu chưa rehearsal trên bản sao.
5. Nếu schema/data thay đổi ngoài dự kiến, giữ database lỗi để forensic; restore sang database mới thay vì restore đè.

## Kế hoạch staging

Staging phải dùng database MySQL trắng và chain đã commit:

```powershell
npx prisma migrate deploy
npx prisma migrate status
npx prisma migrate diff `
  --from-schema-datasource prisma/schema.prisma `
  --to-schema-datamodel prisma/schema.prisma `
  --exit-code
```

Tiêu chí GO:

- First deploy: 16/16 migration successful.
- Status: up to date.
- Diff: rỗng.
- Second deploy: `No pending migrations to apply`.
- Seed staging, nếu dùng, chạy riêng sau migration và phải idempotent/không chứa dữ liệu thật.
- Không dùng `migrate resolve` hoặc `db push` trên staging trắng.

## Điểm dừng phê duyệt

Audit, baseline, fix-forward migration và test database trắng đã hoàn tất. Không có lệnh ghi nào được chạy trên development database gốc. Bước tiếp theo cần xác nhận riêng của người dùng sau khi backup giữ lại và các gate ở trên đã hoàn tất.
