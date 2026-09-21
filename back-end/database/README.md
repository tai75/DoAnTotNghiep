# Database setup

1. Chạy file `init.sql` để tạo database `job_connect`.
2. Chạy tiếp file `schema.sql` để tạo toàn bộ bảng, khóa và index trong MySQL Workbench.
3. Sao chép `.env.example` thành `.env`.
4. Sửa `DATABASE_URL` theo tài khoản MySQL local.
5. Chạy `npm install` rồi `npm run prisma:generate`.
6. Có thể dùng `npm run db:push` để đồng bộ schema từ Prisma trong quá trình phát triển thay cho việc chạy lại SQL.

`prisma/schema.prisma` là schema nguồn để theo dõi thay đổi. Khi schema thay đổi, cập nhật file SQL tương ứng để dễ chạy lại trên MySQL Workbench.
