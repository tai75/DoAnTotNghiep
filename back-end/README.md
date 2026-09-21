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
- `GET /api/jobs` - danh sách việc làm đã đăng
- `GET /api/jobs/:id` - chi tiết việc làm
- `POST /api/jobs` - nhà tuyển dụng tạo tin
- `GET /api/companies/:id` - thông tin công ty
- `PATCH /api/companies/me` - nhà tuyển dụng cập nhật công ty
- `POST /api/applications/jobs/:jobId` - ứng viên ứng tuyển
- `GET /api/applications/me` - ứng viên xem hồ sơ đã ứng tuyển
- `PATCH /api/applications/:id/status` - nhà tuyển dụng cập nhật trạng thái

## Database

- Schema nguồn: `prisma/schema.prisma`
- Tạo database MySQL ban đầu: `database/init.sql`
- Hướng dẫn: `database/README.md`
