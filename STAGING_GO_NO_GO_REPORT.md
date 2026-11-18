# Staging GO/NO-GO Report — Job Connect

Ngày đánh giá: 2026-11-04  
Quyết định tổng thể: **NO-GO cho staging deployment tại thời điểm này**.

Không có staging/production deployment, cloud resource, paid service, development database write hoặc Gemini API call nào được thực hiện.

## Executive gate

| Hạng mục | Trạng thái | Quyết định |
|---|---|---|
| Migration chain trên MySQL trắng | 16/16 deploy pass, status up to date, diff rỗng, deploy lại idempotent | **GO** |
| Backup/restore development clone | Dump được giữ ngoài repo; restore + integrity pass | **GO cho MySQL data** |
| Resolve rehearsal trên clone | 16/16 history rows, checksum khớp, 232 rows không đổi, 0/50 FK orphan | **GO** |
| Git/release integrity | Chỉ 5/16 migration tracked | **NO-GO** |
| Development migration history | Chưa ghi nhận; không có `_prisma_migrations`; chưa có approval | **NO-GO** |
| Backup file ngoài MySQL | CV/logo/upload volume chưa xác minh | **BLOCKED/NEEDS CONFIRMATION** nếu có dữ liệu loại này |
| AI V1 default | Backend/unit/integration/E2E/build pass | **GO có điều kiện** |
| AI V2 legacy | Disabled frontend/backend/service; 410 pass | **NO-GO để bật**, gate hiện tại đạt |
| AI V3 user traffic | Disabled; chưa live Gemini/human-ground-truth evidence | **NO-GO** |

## Đã thực hiện và có bằng chứng

- Audit schema, migration order, raw/data/destructive operations và baseline `07fef94`.
- Test chain 16 migration trên MySQL trắng; schema cuối khớp Prisma datamodel và deploy lần hai không tạo thay đổi.
- Tạo full logical backup giữ ngoài Git, restore vào clone độc lập.
- Chỉ trên clone: resolve 16 migration, đối chiếu history/checksum/status/diff/data/FK.
- Hậu kiểm development chỉ đọc: cả 16 migration vẫn chưa applied và schema diff vẫn rỗng, xác nhận rehearsal không ghi development gốc.
- Backend regression: 95/95 pass.
- Frontend lint: exit 0; build production pass.
- Matching E2E mock: 1/1 pass; production lazy-load E2E: 3/3 pass.
- Xác nhận V1 default, V2/V3 disabled-by-default và không có normal frontend V2 call.

## Chưa thực hiện

- Track/review/commit 11 migration còn thiếu và các báo cáo/script liên quan.
- Freeze development writes và baseline `_prisma_migrations` trên development gốc.
- Backup/restore volume file ngoài MySQL nếu ứng dụng lưu CV/logo/upload trên filesystem/object storage.
- Provision hoặc deploy staging.
- Live Gemini smoke test và human-labeled benchmark; hai việc này không phải điều kiện để staging V1-only chạy, nhưng là điều kiện trước khi bật V3.

## Bị chặn bởi điều kiện môi trường

- Staging chưa tồn tại và task không cho phép tạo cloud resource/deploy.
- Repository đang dirty; 11/16 migration untracked khiến artifact staging không tái lập được từ Git.
- Chưa có bằng chứng backup đồng bộ cho file ngoài database.
- V3 thiếu staging-safe provider configuration, consented/synthetic data và human ground truth.

## Cần người dùng xác nhận

1. Review nội dung 16 migration, sau đó cho phép track/commit; task này không tự `git add` hoặc commit.
2. Xác nhận vị trí lưu CV/logo/upload và yêu cầu backup tương ứng.
3. Sau khi commit/freeze/preflight lại, xác nhận riêng trước khi chạy 16 lệnh `migrate resolve --applied` trên development gốc.
4. Chấp nhận V2 HTTP 410 contract và chính sách V1-only cho staging.

## Các bước còn thiếu để đạt staging GO

Thứ tự bắt buộc, dựa trên evidence thực tế:

1. Review và commit toàn bộ 16 migration cùng checksum đã ghi; không sửa migration sau khi được dùng ở môi trường chung.
2. Xác minh/backup dữ liệu file ngoài MySQL tại cùng recovery point, nếu có.
3. Freeze development writes; kiểm tra lại dump checksum, source↔clone row counts, `_prisma_migrations` vẫn chưa tồn tại và schema diff vẫn rỗng.
4. Người dùng phê duyệt thao tác ghi history development.
5. Resolve lần lượt đúng 16 migration trên development, dừng ngay nếu một bước khác expected; sau đó kiểm tra status, checksum, schema diff và integrity. Không replay DDL bằng `migrate deploy` trên development hiện có.
6. Chỉ khi các gate trên pass: tạo staging MySQL trắng theo quy trình được phê duyệt và chạy `prisma migrate deploy`; không dùng `db push`/`resolve` trên staging trắng.
7. Chạy smoke/regression staging với V1 default, `MATCHING_V2_ENABLED=false`, `MATCHING_V3_ENABLED=false`, `VITE_MATCHING_V2_ENABLED=false`.

## Quyết định cuối

- **Database staging migration: NO-GO** vì migration chưa được Git track đầy đủ và development history chưa được chuẩn hóa có phê duyệt.
- **AI V1-only staging configuration: GO có điều kiện** về mặt code/test, nhưng chưa được deploy vì database/release gate chưa đạt.
- **V2 và V3 user traffic: NO-GO**.
- **Staging deployment tổng thể: NO-GO** cho đến khi hoàn thành các bước 1–5 và có phê duyệt triển khai riêng.
