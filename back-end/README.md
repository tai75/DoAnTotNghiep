# Job Connect Backend

Backend REST API cho hệ thống kết nối việc làm tích hợp AI.

## Chạy local

```powershell
Copy-Item .env.example .env
# Sửa DATABASE_URL và JWT_SECRET trong .env
npm install
npm run prisma:generate
npm run db:push
npm run dev
```

Health check: `GET http://localhost:5000/api/health`

## API hiện có

- `POST /api/auth/register` - đăng ký ứng viên hoặc nhà tuyển dụng
- `POST /api/auth/login` - đăng nhập và nhận JWT
- `GET /api/auth/me` - xem tài khoản hiện tại
- `PATCH /api/auth/me` - cập nhật họ tên, số điện thoại
- `PATCH /api/auth/me/password` - đổi mật khẩu
- `POST /api/auth/logout` - thu hồi JWT hiện tại
- `GET /api/candidates/me` - ứng viên xem hồ sơ cá nhân
- `PATCH /api/candidates/me` - ứng viên cập nhật hồ sơ và CV URL
- `GET /api/candidates/skills` - danh sách kỹ năng
- `PUT /api/candidates/me/skills` - ứng viên cập nhật danh sách kỹ năng
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
- `GET /api/admin/stats` - admin xem thống kê hệ thống
- `GET /api/admin/users` - admin quản lý danh sách tài khoản
- `PATCH /api/admin/users/:id/status` - admin khóa/mở khóa tài khoản
- `GET /api/admin/companies` - admin xem danh sách công ty
- `GET /api/admin/jobs` - admin xem và lọc tin tuyển dụng
- `PATCH /api/admin/jobs/:id/moderation` - admin kiểm duyệt tin tuyển dụng

## Database

- Schema nguồn: `prisma/schema.prisma`
- Tạo database MySQL ban đầu: `database/init.sql`
- Hướng dẫn: `database/README.md`
