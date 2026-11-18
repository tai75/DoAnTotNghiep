# Hướng dẫn triển khai Job Connect Staging

Tài liệu này là runbook chuẩn bị. **Không chạy bước tạo cloud resource hoặc publish nếu chưa có xác nhận.**

## 0. Chốt kiến trúc

Kiến trúc đề xuất:

```text
Browser
  -> Vercel HTTPS (Vite SPA)
       /api/*, /assets/* -> reverse proxy -> Railway backend (1 replica)
  -> Railway private network -> MySQL staging
  -> Railway persistent volume /data -> resumes + logos
  -> Mailtrap Sandbox / Gemini API
```

Same-origin proxy là quyết định quan trọng: frontend để `VITE_API_URL=` và refresh cookie dùng
`SameSite=Strict`. Nếu bỏ proxy và gọi Railway URL trực tiếp, phải đổi `SameSite=None`, CORS chính xác và
chấp nhận rủi ro third-party cookie.

## 1. Đóng migration blocker trước

1. Lấy schema nền ở commit `07fef94` làm nguồn baseline. Không dùng `d7569a2` vì schema đó còn thiếu
   `users.token_version`, trong khi không có migration sau nào bổ sung cột này.
2. Dùng Prisma 6 tạo SQL từ empty database đến schema đó, đặt vào migration có tên sớm hơn
   `20261026120000_add_employment_type_enum`, ví dụ `20261026000000_init`.
3. Review SQL, đặc biệt foreign keys, enum và charset. Commit baseline; không sửa các migration đã chạy.
4. Tạo MySQL disposable hoàn toàn trắng, không có bảng.
5. Chạy:

```powershell
cd back-end
npm ci
npm run prisma:generate
npm run db:migrate:deploy
npm run db:migrate:status
```

6. So sánh schema disposable với `prisma/schema.prisma`, chạy unit/integration tests, rồi xóa database test.
7. Với database cũ đã được tạo bằng `db push`, chỉ reconcile ledger bằng `prisma migrate resolve --applied`
   cho baseline và từng migration thực sự đã hiện diện sau khi đã diff schema, kiểm tra data transform và
   backup. Không được đánh dấu mù. Database staging mới không dùng `resolve`; nó phải chạy baseline thật.

Audit development ngày 2026-11-04 cho thấy 14/14 migration đang ở trạng thái chưa áp dụng trong migration
ledger. Không dùng development DB này làm staging và không chạy `migrate deploy` lên nó để “thử”.

Không tiếp tục nếu bước này chưa pass. Không dùng `prisma db push` trong staging.

## 2. Preflight repository

```powershell
cd back-end
npm ci
npm run prisma:generate
npm run test:unit
npm run test:integration

cd ../front-end-web
npm ci
npm run lint
npm run build
```

Kiểm tra `git status`, commit SHA cần deploy, dependency lockfiles và không có `.env`, dump, CV hoặc key trong
Git. Quét secret trước khi push. Lưu SHA này vào biên bản bảo vệ.

## 3. Tạo tài nguyên — chỉ sau phê duyệt

Trong một Railway project/environment tên `job-connect-staging`:

1. Tạo MySQL riêng; không restore production dump.
2. Tạo backend service root `back-end`.
3. Gắn volume cho backend tại `/data`; tạo `/data/resumes` và `/data/logos` ở runtime.
4. Chỉ chạy một backend replica.
5. Bật backup database/volume nếu plan hỗ trợ; tạo thêm logical `mysqldump` trước migration.
6. Đặt budget/spending alert.

Trên Vercel, tạo project root `front-end-web`, build `npm run build`, output `dist`. Cấu hình rewrite theo thứ
tự: `/api/:path*` đến `<RAILWAY_BACKEND>/api/:path*`, `/assets/:path*` đến
`<RAILWAY_BACKEND>/assets/:path*`, cuối cùng `/(.*)` đến `/index.html`. Vercel yêu cầu SPA rewrite cho Vite
deep links ([official guide](https://vercel.com/docs/frameworks/frontend/vite)).
Repo có `front-end-web/vercel.json.example`; thay placeholder bằng host backend đã được phê duyệt rồi mới đổi
tên thành `vercel.json`. Không deploy nguyên placeholder.

Không cache response `/api/auth/*`, `/api/candidates/resumes/*` hoặc nội dung private tại CDN.

## 4. Cấu hình secret và env

Backend staging tối thiểu:

```dotenv
NODE_ENV=production
DEPLOY_ENV=staging
DATABASE_URL=mysql://<staging-user>:<secret>@<private-host>:3306/job_connect_staging
JWT_SECRET=<random-64-byte-secret>
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d
REFRESH_COOKIE_NAME=job_connect_staging_refresh
REFRESH_COOKIE_SAME_SITE=strict
JWT_ISSUER=job-connect-staging-api
JWT_AUDIENCE=job-connect-staging-web
CORS_ORIGINS=https://<frontend-staging>
FRONTEND_URL=https://<frontend-staging>
API_PUBLIC_URL=https://<frontend-staging>
TRUST_PROXY=true
UPLOADS_DIRECTORY=/data/resumes
LOGOS_DIRECTORY=/data/logos
ALERT_WORKER_ENABLED=false
ALERT_WORKER_CRON=0 * * * *
```

Thêm SMTP sandbox và Gemini bằng secret manager. Không copy giá trị từ production. Frontend giữ:

```dotenv
VITE_API_URL=
VITE_ASSET_URL=
```

Sau khi set env, xác minh platform không in secret trong build log. Frontend không được có `GEMINI_API_KEY`,
`JWT_SECRET`, DB URL hoặc SMTP password.

## 5. Backup, migration và deploy backend

1. Ghi commit SHA và deployment hiện tại.
2. Tạo logical DB dump, lưu encrypted ngoài service; thử đọc danh sách table trong dump.
3. Chụp volume backup nếu khả dụng.
4. Chạy `npm run db:migrate:status`.
5. Chạy `npm run db:migrate:deploy` đúng một lần trong pre-deploy/release phase.
6. Chạy lại status; nếu lỗi, dừng deploy và làm theo rollback plan—không chạy `migrate reset`.
7. Start `npm start`.
8. Xác minh `/api/health/live` 200 và `/api/health/ready` 200 trước khi route traffic.

## 6. Tạo tài khoản demo synthetic

Đặt các secret chỉ trong one-off seed job:

```dotenv
ALLOW_STAGING_SEED=true
STAGING_DATABASE_NAME=job_connect_staging
STAGING_DEMO_CANDIDATE_EMAIL=<synthetic-email>
STAGING_DEMO_CANDIDATE_PASSWORD=<unique-secret>
STAGING_DEMO_RECRUITER_EMAIL=<synthetic-email>
STAGING_DEMO_RECRUITER_PASSWORD=<unique-secret>
STAGING_DEMO_ADMIN_EMAIL=<private-synthetic-email>
STAGING_DEMO_ADMIN_PASSWORD=<separate-private-secret>
```

Chạy `npm run db:seed:staging` một lần. Script từ chối chạy nếu `DEPLOY_ENV`/DB name không đúng và không in
password. Sau đó đặt lại `ALLOW_STAGING_SEED=false` và xóa seed passwords khỏi env thường trực nếu platform
cho phép one-off secret.

Candidate/Recruiter credential có thể để trong tài liệu bảo vệ nội bộ. Admin credential chỉ người trình bày
giữ trong password manager; không đưa vào README, slide công khai, QR code hoặc màn hình quay. Sau bảo vệ,
rotate/disable admin và revoke refresh tokens.

## 7. Email, cron và Gemini

1. Cấu hình Mailtrap Sandbox SMTP; gửi password-reset tới synthetic address và xác nhận mail chỉ nằm sandbox.
2. Tạo một job alert synthetic đến hạn.
3. Giữ cron disabled, chạy one-off `npm run worker:alerts:once`; kiểm tra đúng một notification/email.
4. Chỉ bật cron nếu thật sự cần và backend có đúng một replica.
5. Cấu hình Gemini key bị giới hạn cho staging project; đặt quota/billing alert.
6. Smoke test job-description, chat, resume import bằng CV synthetic. Ghi 429/timeout/fallback.
7. Không demo endpoint matching V2 legacy. Nếu Gemini lỗi, demo luồng thủ công và V1 thay vì retry liên tục.

## 8. Frontend và deep-link

Deploy Vite build sau backend. Với từng URL `/jobs/<id>`, `/profile`, `/recommendations`, `/recruiter`,
`/recruiter/talent`, `/admin`, `/messages`:

1. mở bằng URL trực tiếp ở tab mới;
2. hard refresh;
3. xác minh `index.html` trả 200, lazy chunk trả JavaScript 200, không bị HTML thay cho chunk;
4. xác minh route guard redirect đúng sau refresh/session restore;
5. kiểm tra deploy rollback không để HTML cũ tham chiếu chunk đã bị xóa.

## 9. Rollback runbook

### App-only

1. Tắt traffic/new deployment nếu readiness fail.
2. Rollback Vercel/Railway về deployment SHA trước.
3. Xác minh live/ready, login và direct route.

### Schema/data

1. Không rollback app cũ nếu schema mới không backward-compatible.
2. Nếu migration đã thành công, ưu tiên fix-forward.
3. Nếu bắt buộc restore: tạo MySQL staging mới từ dump, validate row counts, đổi `DATABASE_URL`, restart,
   rồi giữ DB lỗi để điều tra. Không restore đè khi chưa có bản sao.
4. Restore volume tương ứng và đối chiếu `candidate_resumes.path`/logo URL với file thực.

### Secret incident

Rotate Gemini/SMTP/DB/JWT secret. Đổi JWT secret sẽ đăng xuất mọi phiên; đồng thời revoke refresh tokens hoặc
tăng `tokenVersion`. Disable admin demo account ngay.

## 10. Sau buổi bảo vệ

Tắt cron, disable admin, rotate/revoke demo credentials, export artifact cần lưu, xóa CV synthetic không cần
thiết, tải backup cuối, rồi suspend/delete paid resources sau khi người dùng xác nhận. Kiểm tra invoice và
billing alerts; không để database/service chạy quên.

