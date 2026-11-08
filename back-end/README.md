# Job Connect Backend

Backend REST API cho hệ thống kết nối việc làm tích hợp AI.

## Chạy local

```powershell
Copy-Item .env.example .env
# Sửa DATABASE_URL, JWT_SECRET, CORS_ORIGINS và ADMIN_SEED_PASSWORD trong .env
npm install
npm run prisma:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Luồng `db:migrate` ở trên chỉ dành cho database local trắng hoặc database phát triển cô lập
được phép tạo migration mới. Repository hiện có 17 migration đã được kiểm kê và chuẩn hóa LF,
nhưng migration chain canonical LF chưa được rehearsal lại trên MySQL trắng.

Development database hiện có dữ liệu nhưng chưa có bảng `_prisma_migrations`. Không dùng
`db:migrate`, `db:push`, `db:migrate:deploy` hoặc `migrate reset` trên database này để sửa
migration history, và không tự baseline. Việc chuẩn hóa history chỉ được thực hiện theo kế
hoạch database safety gate, sau backup/restore rehearsal và phê duyệt riêng.

`JWT_SECRET`, `DATABASE_URL` là biến bắt buộc; server sẽ từ chối khởi động nếu thiếu.
`CORS_ORIGINS` nhận nhiều origin, phân tách bằng dấu phẩy.
Seed demo không chạy trong production và cần `ADMIN_SEED_PASSWORD`.

### Local persistent storage

CV và logo mới được lưu dưới `STORAGE_ROOT/resumes` và `STORAGE_ROOT/logos` bằng UUID storage
key, không dùng tên file phía client. CV không được public; download luôn đi qua API có RBAC.
Logo public giữ contract `/assets/logos/:key` và được trả về với MIME cố định cùng `nosniff`.
Nếu chạy nhiều API instance, tất cả instance phải mount cùng một persistent volume tại cùng đường
dẫn. Local filesystem không tự nhân bản dữ liệu giữa các host.

Reconciliation chỉ đọc và không xóa file:

```powershell
npm run storage:reconcile
```

Backup storage phải được chạy trong maintenance window/quiesced writes và ghép với một database
snapshot nhất quán. Thư mục đích phải chưa tồn tại; manifest chứa SHA-256 và snapshot ID:

```powershell
npm run storage:backup -- --destination D:\backups\job-connect-files-20261107 --database-snapshot-id db-20261107-120000
npm run storage:verify -- --source D:\backups\job-connect-files-20261107
$env:ALLOW_STORAGE_RESTORE='true'
npm run storage:restore -- --source D:\backups\job-connect-files-20261107 --target D:\restore-rehearsal\job-connect-files --database-snapshot-id db-20261107-120000
```

Restore được cung cấp qua module vận hành và chỉ chấp nhận target rỗng sau khi toàn bộ checksum
backup hợp lệ. Luôn rehearsal vào QA volume mới, đối chiếu `databaseSnapshotId`, rồi mới đổi mount;
không restore đè lên volume đang hoạt động. File legacy chỉ được đọc tương thích, không tự động
di chuyển hoặc xóa.

Health checks: `GET /api/health/live` (process) và `GET /api/health/ready` (MySQL readiness).

## API hiện có

- `POST /api/auth/register` - đăng ký ứng viên hoặc nhà tuyển dụng
- `POST /api/auth/login` - đăng nhập, nhận access token ngắn hạn; refresh token được lưu trong cookie HttpOnly
- `POST /api/auth/refresh` - xoay refresh token và cấp access token mới
- `GET /api/auth/me` - xem tài khoản hiện tại
- `PATCH /api/auth/me` - cập nhật họ tên, số điện thoại
- `PATCH /api/auth/me/password` - đổi mật khẩu
- `POST /api/auth/logout` - thu hồi access/refresh token
- `GET /api/candidates/me` - ứng viên xem hồ sơ cá nhân
- `PATCH /api/candidates/me` - ứng viên cập nhật hồ sơ, mong muốn việc làm và `isSearchable`
- `GET /api/candidates/skills` - danh sách kỹ năng
- `GET /api/candidates` - nhà tuyển dụng tìm ứng viên đang bật `isSearchable`, hỗ trợ `search`, `location`, `desiredPosition`, `page`, `limit`
- `PUT /api/candidates/me/skills` - ứng viên cập nhật danh sách kỹ năng
- `GET|POST|PATCH|DELETE /api/candidates/me/educations` - ứng viên quản lý học vấn
- `GET|POST|PATCH|DELETE /api/candidates/me/experiences` - ứng viên quản lý kinh nghiệm
- `GET|POST|PATCH|DELETE /api/candidates/me/projects` - ứng viên quản lý dự án
- `GET /api/candidates/me/resumes` - ứng viên xem danh sách CV
- `POST /api/candidates/me/resumes` - upload CV dạng multipart field `file` (PDF/DOCX, tối đa 5MB)
- `PATCH /api/candidates/me/resumes/:id` - đổi tên CV; `PATCH /api/candidates/me/resumes/:id/default` đặt CV mặc định
- `DELETE /api/candidates/me/resumes/:id` - xóa CV
- `GET /api/candidates/resumes/:id/download` - tải CV; chỉ chủ CV, recruiter thuộc công ty có job ứng viên đã ứng tuyển, hoặc admin
- `GET|POST|DELETE /api/candidates/me/saved-jobs` - ứng viên quản lý việc làm đã lưu
- `GET /api/jobs` - danh sách việc làm đã đăng, hỗ trợ `search`, `location`, `company`, `employmentType`, `skill` (nhiều kỹ năng phân cách bằng dấu phẩy), `minSalary`, `maxSalary`, `sort` (`newest`, `salary_high`, `salary_low`), `page`, `limit`
- `GET /api/jobs/me` - nhà tuyển dụng xem các tin của công ty mình
- `GET /api/jobs/:id` - chi tiết việc làm
- `POST /api/jobs` - nhà tuyển dụng tạo tin
- `PATCH /api/jobs/:id` - nhà tuyển dụng sửa tin của mình
- `DELETE /api/jobs/:id` - đóng tin tuyển dụng của mình
- `GET /api/companies/:id` - thông tin công ty
- `PATCH /api/companies/me` - nhà tuyển dụng cập nhật công ty
- `POST /api/applications/jobs/:jobId` - ứng viên ứng tuyển
- `GET /api/applications/me` - ứng viên xem hồ sơ đã ứng tuyển
- `GET /api/applications/:id` - ứng viên hoặc nhà tuyển dụng xem chi tiết hồ sơ có quyền truy cập
- `PATCH /api/applications/:id/withdraw` - ứng viên rút hồ sơ
- `GET /api/applications/managed` - nhà tuyển dụng xem ứng viên của công ty, hỗ trợ `jobId`, `status`, `page`, `limit`
- `PATCH /api/applications/:id/status` - nhà tuyển dụng cập nhật trạng thái
- `POST /api/auth/password-reset/request` và `POST /api/auth/password-reset/confirm` - yêu cầu/xác nhận đặt lại mật khẩu
- `GET /api/notifications` - xem thông báo của tài khoản; hỗ trợ đánh dấu đã đọc và xóa
- `GET /api/admin/stats` - admin xem thống kê theo `from`, `to`, `groupBy=day|month|year`, gồm user theo role/status, job và application theo status
- `GET /api/admin/users` - admin quản lý danh sách tài khoản
- `GET /api/admin/users/:id` - admin xem chi tiết user và hồ sơ liên quan
- `GET /api/admin/audit-logs` - admin xem audit log, hỗ trợ lọc `action`, `entity`, `userId`, `from`, `to`
- `PATCH /api/admin/users/:id/status` - admin khóa/mở khóa tài khoản
- `GET /api/admin/companies` - admin xem danh sách công ty
- `GET /api/admin/jobs` - admin xem và lọc tin tuyển dụng
- `PATCH /api/admin/jobs/:id/moderation` - admin kiểm duyệt tin tuyển dụng

Nếu chưa cấu hình `SMTP_HOST`, `SMTP_USER` và `SMTP_PASSWORD`, email không được gửi và reset token
không được in ra console. Frontend không lưu JWT vào localStorage;
access token chỉ tồn tại trong bộ nhớ của tab, còn refresh token dùng cookie HttpOnly,
SameSite và Secure ở production.

## Staging

Không dùng `db:push` hoặc `migrate dev` cho staging. Repository đã có baseline và đủ 17 migration
canonical LF, nhưng chưa có bằng chứng blank-chain rehearsal sau bước chuẩn hóa LF; vì vậy staging
chưa GO. Chỉ dùng `npm run db:migrate:deploy` sau khi chain canonical vượt qua rehearsal trên MySQL
test cô lập và các safety gate được phê duyệt. File upload cần một persistent volume dùng chung
qua `STORAGE_ROOT`; production sẽ từ chối khởi động nếu biến này thiếu, trỏ vào source tree hoặc
không cho phép write/rename/delete. `UPLOADS_DIRECTORY` và `LOGOS_DIRECTORY` chỉ là đường dẫn
đọc tương thích cho file legacy. Tài khoản synthetic staging được chuẩn bị bằng
`npm run db:seed:staging` với guardrail trong `.env.example`; không chạy seed nếu chưa xác nhận đúng database.

## Database

- Schema nguồn: `prisma/schema.prisma`
- Migration: `prisma/migrations/` — 17 migration canonical LF đã được kiểm kê
- Tạo database MySQL ban đầu: `database/init.sql`
- Hướng dẫn: `database/README.md`

## Test

```powershell
npm test
```

Các endpoint có tham số ID đều trả về `400` khi ID không phải số nguyên dương.
Loại hình việc làm hợp lệ: `FULL_TIME`, `PART_TIME`, `INTERNSHIP`, `CONTRACT`, `REMOTE`, `HYBRID`.
