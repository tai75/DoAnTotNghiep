# Database setup

Repository có 16 Prisma migration đã được kiểm kê và chuẩn hóa LF. `prisma/schema.prisma` và
thư mục `prisma/migrations/` là nguồn duy nhất của schema; không còn duy trì bản sao `schema.sql`.

## Database trắng

1. Sao chép `.env.example` thành `.env` và cấu hình `DATABASE_URL` cho MySQL local/test cô lập.
2. Chạy `init.sql` để tạo database nếu database chưa tồn tại.
3. Chạy `npm install` và `npm run prisma:generate`.
4. Sau khi canonical LF blank-chain rehearsal được xác nhận PASS, dùng
   `npm run db:migrate:deploy` để tạo toàn bộ bảng, khóa và index.

Không coi inventory 16 migration là bằng chứng blank-chain PASS. Rehearsal sau chuẩn hóa LF chưa
được thực hiện và phải dùng MySQL test cô lập.

## Development database hiện có

Development database hiện có dữ liệu và chưa có bảng `_prisma_migrations`. Không chạy `db:push`,
`db:migrate`, `db:migrate:deploy`, `migrate reset` hoặc tự đánh dấu migration applied để sửa history.
Chỉ baseline theo database safety plan sau khi có backup, restore rehearsal, schema/data invariants
và phê duyệt riêng.

## Cảnh báo staging

Baseline đã tồn tại trong migration chain, nhưng staging chưa GO. Không dùng `db push` hoặc
`migrate dev` trên staging. Chỉ chạy `npm run db:migrate:deploy` sau khi canonical LF chain vượt
qua blank-chain rehearsal và release/database safety gate được phê duyệt.
