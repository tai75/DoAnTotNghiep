# Database Safety Gate Report — Job Connect

Ngày kiểm tra: 2026-11-04  
Phạm vi: development MySQL cục bộ được đọc; mọi thao tác ghi chỉ thực hiện trên database clone độc lập. Không chạy `migrate resolve`, `migrate deploy`, `db push`, `migrate reset` hoặc `DROP` trên development gốc.

## Kết luận

Safety rehearsal trên clone **PASS**, nhưng database migration vẫn **NO-GO cho staging** vì chỉ 5/16 migration đang được Git track. Development gốc chưa được baseline history và không bị thay đổi trong lần kiểm tra này.

Hậu kiểm sau toàn bộ rehearsal: `prisma migrate status` trên development vẫn liệt kê đúng 16 migration chưa applied; live database → `schema.prisma` vẫn trả `No difference detected`. Exit code 1 của `migrate status` là expected vì history chưa được baseline, không phải test failure.

## Trạng thái theo nhóm

| Nhóm | Trạng thái | Bằng chứng |
|---|---|---|
| Đã thực hiện | PASS | Full dump có lưu giữ; restore vào clone; exact row-count; kiểm tra 50 foreign key; resolve 16 migration trên clone; checksum/history/status/schema diff đều pass |
| Chưa thực hiện | NO-GO | Chưa baseline history trên development; chưa deploy staging; chưa backup volume chứa CV/logo/upload nếu các file này nằm ngoài MySQL |
| Bị chặn bởi môi trường/repository | NO-GO | 11/16 migration chưa được Git track; worktree có nhiều thay đổi chưa commit |
| Cần người dùng xác nhận | REQUIRED | Review/track/commit migration; xác nhận backup file ngoài MySQL; phê duyệt cửa sổ ghi history development |

## Git tracking và checksum

Thứ tự dưới đây là thứ tự Prisma thực thi theo tên thư mục. SHA-256 được tính trực tiếp từ `migration.sql`; clone có 16 history rows và không có checksum mismatch.

| # | Migration | Git tracked | SHA-256 |
|---:|---|:---:|---|
| 1 | `20261026000000_baseline_07fef94` | Không | `f1375f60fdc886da2c98f0886819449a36bf2e2568581383671d4690247616fe` |
| 2 | `20261026120000_add_employment_type_enum` | Có | `25f18113d19bf504b942da1f678b66ae4d9681ed33ac693afb3ea0a408da3a1b` |
| 3 | `20261026123000_add_candidate_profiles_and_interactions` | Có | `9cbb78396b8352d5d455a32fec0670ebb13008ca48deab493c26f38d47a65fa0` |
| 4 | `20261026124000_add_job_moderation_note` | Có | `5d9b4350f36815ac5a05d14629699a1a7fb8b890a4f9a60e0074ce3a3aea0242` |
| 5 | `20261026124500_add_refresh_tokens` | Có | `362d533b1086c23b65ea25d002445a715fb80f719accacb1875ff85386fdd984` |
| 6 | `20261026125000_redesign_match_scores` | Có | `5fd40e9d202b7e75d29901e89eb8f6586b0f1fff631e2c07cb7abebf432be107` |
| 7 | `20261102164500_add_job_required_years_experience` | Không | `a13fdea0470c5f087e79ba46fe8ef807b3ebe8a09f72d6d7eea7c4e48f7a8edf` |
| 8 | `20261102171500_add_job_screening_questions` | Không | `415c439c1aef46e64c3b85fd7c0a2717578b99fedd9a4fbddd92e18a0880f63b` |
| 9 | `20261102183900_add_job_alerts` | Không | `0ba4d53b81a6628ec3400d05fbc7cfdda064aac9b2712b0435db1f271cca1119` |
| 10 | `20261102190000_add_application_notes` | Không | `e63f9358c4c958c34088c2f081cb329995391d61211e0f0479b9a7128833d802` |
| 11 | `20261102191500_add_talent_search_and_job_views` | Không | `aa732436626c5cfe1ec7c25c254c06d9eb5b4112c7c5f6d854c15f968c11f244` |
| 12 | `20261102192500_add_company_follows_reviews` | Không | `f5e0b23343fbe5b2475d8e501892f3ac01a35ef2dc02c35d90224f0b8c837dc7` |
| 13 | `20261102194500_add_resume_job_analyses` | Không | `b9c558ee4385bf1d0e84fa7b21699b913a9db9ba6ed586d426fdd28fd2b38260` |
| 14 | `20261102195500_add_matching_v2_cache` | Không | `1fb6976905539b1fe48f2e04ff764bdfb278d899ea679fb5125eb7179534ca89` |
| 15 | `20261102200500_add_conversations_messages` | Không | `d522c5759babc4685d26ccb64d6df5c10ede4d5854ade5c3a352d2a060a96e2f` |
| 16 | `20261102201500_reconcile_migration_schema` | Không | `eefa6a2fb4167c0011e74121d52fde105ecb1982b91884500cc6fdb78baab637` |

Không migration cũ nào bị sửa trong safety rehearsal. Baseline mới và fix-forward cuối chain vẫn chưa được commit, nên checksum chưa được coi là immutable cho staging.

## Backup và restore evidence

- Full logical dump: `%LOCALAPPDATA%\JobConnect\backups\job_connect_dev_20261104T093949497Z.sql`.
- Kích thước: 81,652 bytes.
- SHA-256: `ab8685d97a98b486c827082bf99b5a68b2371e1cc4959d529e16a3f2be037789`.
- Dump dùng `--single-transaction --routines --triggers --events --hex-blob --set-gtid-purged=OFF` và không đưa password/URL vào command output hoặc báo cáo.
- Vị trí nằm ngoài repository; dump không xuất hiện trong Git status.
- Restore target được giữ lại: `job_connect_safety_clone_20261104t093949`.
- Restore khớp 35 business tables và tổng 232 rows với source.
- Backup file ngoài MySQL như CV/logo/upload chưa được xác minh; đây là gate riêng nếu cần point-in-time restore đầy đủ ứng dụng.

## Resolve rehearsal chỉ trên clone

Script kiểm thử: `back-end/scripts/database-safety-gate.cjs`. Script không chứa `DROP`, giữ lại dump/clone và dùng clone-specific `DATABASE_URL` khi gọi Prisma.

Kết quả:

- 16/16 migration được `resolve --applied` tuần tự trên clone.
- `_prisma_migrations`: 16 rows, 0 unsuccessful/rolled back, 0 checksum mismatch.
- `prisma migrate status`: `Database schema is up to date!`.
- Live clone → `schema.prisma`: `No difference detected.`
- 232 business rows không đổi trước/sau resolve.
- 50 foreign keys được kiểm tra, 0 orphan row.
- `match_scores`: 3 rows; 0 candidate mismatch; 0 incomplete backfill.
- 0 invalid employment type; 0 duplicate `(candidate_id, job_id)`.

Điều này chứng minh cả 16 migration có thể được ghi nhận applied trên một bản sao chính xác của development mà không bỏ sót schema/data hiện tại. Nó không phải là quyền tự động ghi history vào development gốc.

## Đối chiếu migration/schema và rủi ro

| Migration/nhóm | Schema/data effect | Điều kiện an toàn đã kiểm tra |
|---|---|---|
| Baseline `07fef94` | 13 bảng nền | Chỉ deploy lên DB trắng; trên clone có schema sẵn chỉ resolve history |
| Employment enum | Data normalization + type change | 0 giá trị ngoài enum |
| Match score redesign | Backfill, NOT NULL, FK, unique | 0 incomplete/mismatch/duplicate |
| Feature migrations #3–#15 | Thêm bảng/cột/index | Schema hiện tại đã có đầy đủ; exact diff rỗng |
| Reconcile #16 | Rename columns, index reconciliation, NOT NULL, FK | Schema clone đã ở trạng thái đích; resolve không đổi row count |

Chi tiết DDL/data/raw/destructive review nằm trong `DATABASE_MIGRATION_AUDIT.md`. Không migration nào có `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` hoặc `DELETE`; các điểm nhạy cảm là enum conversion, backfill/NOT NULL, unique, rename và drop index dư.

## Lệnh dự kiến cho development — chưa chạy

Chỉ sau khi 16 migration đã được review/commit, freeze write, xác minh lại backup/checksum và người dùng phê duyệt rõ ràng:

```powershell
# Chạy lần lượt đúng 16 tên trong bảng trên, từ thư mục back-end.
npx prisma migrate resolve --applied <MIGRATION_NAME>

npx prisma migrate status
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Không dùng `migrate deploy`, `db push` hoặc `migrate reset` trên development. Nếu bất kỳ preflight/checksum/status nào khác evidence này, dừng và audit lại; không tiếp tục resolve hàng loạt.

## Gate cuối

| Hạng mục | GO/NO-GO |
|---|---|
| Backup MySQL + restore clone | **GO** |
| Clone resolve/history/schema/data integrity | **GO** |
| Migration files sẵn sàng phát hành | **NO-GO** — 11 file chưa tracked |
| Ghi history development | **NO-GO** — chưa được người dùng xác nhận và chưa freeze/commit |
| Staging `migrate deploy` | **NO-GO** cho đến khi hai gate trên hoàn tất |

