# Database Migration Audit — Job Connect

Ngày audit: 2026-11-04  
Phạm vi: Prisma ORM 6.19.3, MySQL 8.0.43, development database cục bộ và database test tách biệt.  
Nguyên tắc: không ghi vào development database gốc; không ghi password, connection string hoặc dữ liệu nghiệp vụ vào báo cáo.

## Kết luận điều hành

- Development database hiện **khớp hoàn toàn** với `back-end/prisma/schema.prisma`: `prisma migrate diff` trả về `No difference detected`.
- Development database **không có** bảng `_prisma_migrations`. `prisma migrate status` ban đầu báo toàn bộ 14 migration chưa applied. Đây là **migration history chưa được ghi nhận**, không phải schema drift tại thời điểm audit.
- Chuỗi 14 migration ban đầu **không thể chạy từ MySQL trắng** vì migration đầu tiên giả định các bảng nền đã tồn tại.
- Commit `07fef94` là snapshot schema nền 13 bảng, có `users.token_version`, không phải migration. Snapshot này phù hợp làm nguồn initial baseline đứng trước 14 migration.
- Khi test baseline + 14 migration, phát hiện migration result còn lệch datamodel ở bốn nhóm. Một migration fix-forward được thêm cuối chuỗi, không sửa 14 migration cũ.
- Chuỗi cuối cùng gồm **16 migration** đã pass trên MySQL trắng; schema diff rỗng; deploy lần hai không tạo thay đổi.
- Backup/restore drill bằng dump tạm đã pass: 35 bảng nghiệp vụ, 232 rows, không lệch row count. Dump tạm và hai database test đã được xóa sau test. **Chưa có bản backup đầy đủ được giữ lại để dùng cho thao tác development thật.**
- Trạng thái staging hiện tại: **NO-GO có điều kiện**. Chuyển thành GO sau khi các migration được review/commit, tạo và giữ backup development đầy đủ, rồi baseline history development theo kế hoạch đã phê duyệt.

## Bằng chứng audit chỉ đọc trên development

| Kiểm tra | Kết quả |
|---|---|
| `prisma validate` | Hợp lệ |
| `prisma migrate status` trước khi thêm baseline | 14 migration đều chưa applied |
| `_prisma_migrations` | Không tồn tại |
| Live DB → `schema.prisma` | Không có khác biệt |
| MySQL | 8.0.43 |
| Base tables | 35, không tính `_prisma_migrations` |
| Dữ liệu hiện có | Có dữ liệu development; audit chỉ dùng aggregate, không xuất nội dung nhạy cảm |
| `match_scores` data invariant | 3 rows; 0 candidate mismatch; 0 row thiếu trường backfill; score 45–65 |
| `jobs.employment_type` | 3 rows, đều là `FULL_TIME`; không có giá trị ngoài enum |

### Phân loại vấn đề

- **Schema drift:** khác biệt giữa cấu trúc live database và `schema.prisma`. Kết quả hiện tại: **không có**.
- **Migration history conflict:** lịch sử trong `_prisma_migrations` mâu thuẫn với file migration, checksum thay đổi, migration failed/rolled back, hoặc database ghi nhận migration không còn trên filesystem. Kết quả hiện tại: **chưa có history để xung đột**.
- **Migration chưa được ghi nhận:** schema đã tồn tại nhưng `_prisma_migrations` không có record tương ứng. Kết quả hiện tại: **đúng vấn đề của development**.
- **Migration-chain drift:** schema tạo từ migration filesystem khác với datamodel. Chuỗi 14 migration ban đầu có loại drift này; migration fix-forward mới đã xử lý.

## Baseline `07fef94`

`07fef94` (`feat: add recruitment backend and frontend foundations`) chứa schema nền trước các thay đổi incremental. Delta riêng của commit này thêm `users.token_version`; toàn bộ snapshot có 13 bảng nền:

`users`, `candidates`, `companies`, `recruiters`, `skills`, `candidate_skills`, `jobs`, `job_skills`, `applications`, `application_status_history`, `match_scores`, `recommendations`, `audit_logs`.

Baseline mới `20261026000000_baseline_07fef94` có SQL được chuẩn hóa và đối chiếu semantic với `back-end/database/schema.sql` tại commit `07fef94`: kết quả khớp. Nó giữ `jobs.employment_type` là `VARCHAR(50)` và schema `match_scores` cũ để hai data migration kế tiếp có đúng input.

Không dùng schema hiện tại làm một baseline squashed duy nhất vì cách đó làm mất chuỗi biến đổi dữ liệu và làm lịch sử khó đối chiếu với 14 migration đã tồn tại.

## Bảng đối chiếu migration và schema

| # | Migration | Tác động chính | Data/raw/destructive review | Kết quả |
|---:|---|---|---|---|
| 1 | `20261026000000_baseline_07fef94` | Tạo 13 bảng nền | Raw DDL; chỉ chạy trên DB trắng | Pass |
| 2 | `20261026120000_add_employment_type_enum` | Chuẩn hóa dữ liệu rồi đổi `VARCHAR` thành enum | Có `UPDATE`; đổi type có thể fail/truncate nếu còn giá trị lạ | Pass; dev preflight sạch |
| 3 | `20261026123000_add_candidate_profiles_and_interactions` | Thêm profile fields, resume, saved job, notification, reset token | DDL lớn; cột mới nullable/default; không xóa dữ liệu | Pass |
| 4 | `20261026124000_add_job_moderation_note` | Thêm nullable text | Không destructive | Pass |
| 5 | `20261026124500_add_refresh_tokens` | Tạo refresh token table | Không destructive | Pass |
| 6 | `20261026125000_redesign_match_scores` | Backfill candidate và component scores, thêm FK/check/unique | Có `UPDATE`; nullable → required; unique có thể fail nếu duplicate | Pass; dev invariant sạch |
| 7 | `20261102164500_add_job_required_years_experience` | Thêm nullable decimal | Không destructive | Pass |
| 8 | `20261102171500_add_job_screening_questions` | Tạo questions/answers | Không destructive; tên cột ban đầu lệch datamodel | Pass, sửa ở #16 |
| 9 | `20261102183900_add_job_alerts` | Tạo job alerts | Không destructive | Pass |
| 10 | `20261102190000_add_application_notes` | Tạo application notes | Không destructive | Pass |
| 11 | `20261102191500_add_talent_search_and_job_views` | Tạo saved search, invitation, job views | Không destructive | Pass |
| 12 | `20261102192500_add_company_follows_reviews` | Thêm company fields, follows, reviews | Cột mới nullable; không xóa dữ liệu | Pass |
| 13 | `20261102194500_add_resume_job_analyses` | Tạo resume analysis | Thiếu `candidateId` so với datamodel | Pass, sửa ở #16 |
| 14 | `20261102195500_add_matching_v2_cache` | Tạo embedding cache và score v2 | Không destructive | Pass |
| 15 | `20261102200500_add_conversations_messages` | Tạo conversations/messages | Không destructive | Pass |
| 16 | `20261102201500_reconcile_migration_schema` | Rename answer columns, chuẩn hóa job indexes, siết `employment_score`, thêm analysis candidate FK | Rename giữ dữ liệu; drop composite index; nullable → required cần preflight nếu áp dụng sau một khoảng thời gian | Pass |

Không migration nào có `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` hoặc `DELETE`. Các thao tác cần chú ý nhất là đổi enum, backfill + siết `NOT NULL`, unique constraint, rename cột và drop index dư.

## Kết quả thử trên MySQL trắng

Môi trường test: hai database MySQL riêng, tên ngẫu nhiên có prefix `job_connect_audit_`; development gốc chỉ được đọc.

### Chuỗi trước khi sửa

Baseline + 14 migration chạy được nhưng schema diff phát hiện:

1. `application_answers.application_id/question_id` khác `applicationId/questionId` trong datamodel.
2. `jobs` còn composite index nền, thiếu hai single-column index mong muốn.
3. `match_scores.employment_score` còn nullable.
4. `resume_job_analyses` thiếu `candidateId` và foreign key.

### Chuỗi cuối cùng

| Kiểm tra | Kết quả |
|---|---|
| First `prisma migrate deploy` | 16/16 applied thành công |
| `prisma migrate status` | Database schema is up to date |
| DB → `schema.prisma` diff | No difference detected |
| `_prisma_migrations` | 16 successful, 0 failed |
| Base tables gồm history | 36 |
| Second `prisma migrate deploy` | No pending migrations to apply |

Database test và dump tạm do audit tạo đã được xóa sau khi kiểm thử; development database không bị thay đổi.

## Backup và restore

### Trạng thái

- `back-end/database/job_connect_virtual.sql` là schema-only: 35 `CREATE TABLE`, 0 `INSERT`, không có `_prisma_migrations`. File này không phải full backup và không đủ để bảo toàn development data.
- Một logical dump tạm được tạo bằng MySQL `mysqldump` 8.0.43 với `--single-transaction --routines --triggers --events --hex-blob`.
- Restore vào database riêng pass: 35 bảng, tổng 232 rows ở source và restore, không có table-level row-count mismatch.
- Dump tạm đã bị xóa sau drill để không lưu dữ liệu nhạy cảm trong workspace. Trước thao tác thật phải tạo dump mới, giữ ở vị trí mã hóa/kiểm soát truy cập và ghi checksum ngoài repo.
- Backup file upload/CV/logo nằm ngoài phạm vi MySQL; nếu môi trường development có file cần bảo toàn, phải backup volume tương ứng cùng một recovery point.

### Restore strategy

1. Không restore đè database gốc.
2. Tạo database mới, restore dump vào đó.
3. Kiểm tra exit code, checksum dump, số bảng, exact row counts và schema diff.
4. Chạy smoke test bằng connection tạm tới database restored.
5. Chỉ đổi `DATABASE_URL` sang bản restored khi rollback được phê duyệt; giữ database lỗi để điều tra.

## Quyết định phương án

Chọn: **baseline history hiện có bằng một initial baseline mới + giữ nguyên 14 migration + một fix-forward migration cuối chuỗi**.

Không chọn:

- Chạy 14 migration trực tiếp trên development: sẽ đụng các bảng/cột đã tồn tại và có nguy cơ DDL partial failure.
- `db push`, `migrate reset`, `DROP DATABASE` hoặc `migrate deploy` trên development: không phù hợp yêu cầu bảo toàn dữ liệu.
- Đánh dấu hàng loạt mà không kiểm tra: đã thay bằng schema diff, clean-DB rehearsal, migration-by-migration review và data invariant checks.
- Squash toàn bộ thành current-schema baseline: bỏ mất data migration semantics và làm yếu audit trail.

## GO / NO-GO

**Hiện tại: NO-GO cho staging release.**

Chuyển thành **GO** khi đồng thời thỏa:

1. 16 migration và hai báo cáo được review, commit; không còn migration file cần sửa.
2. Có full logical backup development được giữ lại, checksum xác minh, và backup volume/file nếu có.
3. Người phụ trách xác nhận cho phép ghi migration history vào development.
4. Thực hiện tuần tự 16 lệnh `migrate resolve --applied`, rồi `migrate status` up to date và schema diff rỗng.
5. Staging phải là MySQL trắng và chạy `prisma migrate deploy`; không dùng `resolve` hoặc `db push` trên staging trắng.

Chi tiết lệnh, gate và rollback nằm trong `DATABASE_BASELINE_PLAN.md`.
