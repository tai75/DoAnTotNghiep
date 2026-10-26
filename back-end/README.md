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

`JWT_SECRET`, `DATABASE_URL` là biến bắt buộc; server sẽ từ chối khởi động nếu thiếu.
`CORS_ORIGINS` nhận nhiều origin, phân tách bằng dấu phẩy.
Seed demo không chạy trong production và cần `ADMIN_SEED_PASSWORD`.

Health check: `GET http://localhost:5000/api/health`

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

Nếu chưa cấu hình `SMTP_HOST`, `SMTP_USER` và `SMTP_PASSWORD`, liên kết đặt lại mật khẩu
được in ra console ở môi trường development. Frontend không lưu JWT vào localStorage;
access token chỉ tồn tại trong bộ nhớ của tab, còn refresh token dùng cookie HttpOnly,
SameSite và Secure ở production.

## Database

- Schema nguồn: `prisma/schema.prisma`
- Migration: `prisma/migrations/`
- Tạo database MySQL ban đầu: `database/init.sql`
- Hướng dẫn: `database/README.md`

## Test

```powershell
npm test
```

Các endpoint có tham số ID đều trả về `400` khi ID không phải số nguyên dương.
Loại hình việc làm hợp lệ: `FULL_TIME`, `PART_TIME`, `INTERNSHIP`, `CONTRACT`, `REMOTE`, `HYBRID`.
