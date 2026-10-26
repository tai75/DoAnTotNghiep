# Database setup

1. Chạy file `init.sql` để tạo database `job_connect`.
2. Dùng Prisma migration để tạo/cập nhật toàn bộ bảng, khóa và index:
   `npm run db:migrate`
3. Sao chép `.env.example` thành `.env`.
4. Sửa `DATABASE_URL` theo tài khoản MySQL local.
5. Chạy `npm install` rồi `npm run prisma:generate`.
6. Có thể dùng `npm run db:push` để đồng bộ schema từ Prisma trong quá trình phát triển.

`prisma/schema.prisma` và thư mục `prisma/migrations/` là nguồn duy nhất của schema. Không còn duy trì bản sao `schema.sql`.
