# Deployment Readiness — Job Connect Staging

Ngày audit: **2026-11-04** (Asia/Saigon)  
Phạm vi: React/Vite, Node.js/Express, Prisma 6/MySQL, Gemini API, JWT + refresh cookie  
Quyết định hiện tại: **NO-GO — chưa được triển khai công khai**

Không có website, DNS, dịch vụ cloud hay tài nguyên trả phí nào được tạo trong lần chuẩn bị này.

## 1. Kết luận điều hành

Code có nền tảng bảo mật phù hợp cho demo: CORS allowlist, access token ngắn hạn, refresh token HttpOnly có
rotation/replay detection, upload có giới hạn và kiểm tra signature, request ID, graceful shutdown và rate
limit. Tuy nhiên chưa được phép deploy staging cho đến khi đóng các blocker sau:

1. **Migration thiếu baseline.** Database trắng chạy `prisma migrate deploy` sẽ thất bại vì migration đầu tiên
   giả định các bảng nền đã tồn tại. `database/init.sql` chỉ tạo database và từng dựa vào `db push`.
2. **Storage cần volume bền vững.** CV và logo đang ghi local disk. Code đã hỗ trợ cấu hình
   `UPLOADS_DIRECTORY`/`LOGOS_DIRECTORY`, nhưng host phải gắn persistent volume và phải kiểm tra qua restart.
3. **SPA host chưa có rewrite đã triển khai.** `BrowserRouter` và lazy chunks yêu cầu mọi deep link trả
   `index.html`; nếu thiếu, refresh `/admin`, `/jobs/:id`, `/profile` sẽ 404.
4. **Chưa provision secret/tài khoản staging.** Script seed có guardrail đã được chuẩn bị nhưng chưa chạy.
5. **Chưa kiểm thử end-to-end trên HTTPS/proxy thật.** Cookie `SameSite`, forwarding headers, CORS, upload,
   email sandbox và Gemini phải được xác minh trên URL staging cuối cùng.

## 2. Ma trận audit

| Hạng mục | Trạng thái | Bằng chứng / hành động bắt buộc |
|---|---|---|
| Backend env | Conditional | `DATABASE_URL`, `JWT_SECRET` bắt buộc; production từ chối JWT secret <32 ký tự và URL HTTP. `.env.example` không chứa secret thật. |
| Frontend API URL | Pass có điều kiện | Mặc định `/api`, phù hợp same-origin proxy. `VITE_API_URL` chỉ được dùng nếu API là origin HTTPS riêng. |
| CORS | Pass có điều kiện | Exact allowlist, credentials bật, wildcard bị từ chối; staging phải chỉ chứa frontend origin HTTPS. |
| Refresh cookie | Pass có điều kiện | HttpOnly, Secure khi `NODE_ENV=production`, path `/api/auth`; mặc định `SameSite=Strict`. Cross-site chỉ dùng `None` trên HTTPS và vẫn có rủi ro browser chặn third-party cookie. |
| HTTPS/proxy | Chưa xác minh | TLS phải kết thúc ở platform; bật `TRUST_PROXY=true` chỉ sau khi xác nhận chuỗi proxy và `req.ip`/rate-limit hoạt động đúng. |
| Prisma deploy | **Blocker** | Có script `db:migrate:deploy`, nhưng thiếu initial baseline migration. Không dùng `db push` cho staging. |
| Rollback DB | Conditional | Prisma 6 không có down migration chung cho migration đã thành công; cần backup + app rollback + fix-forward. Migration thất bại dùng `migrate resolve` có kiểm soát. |
| Staging DB | Chưa tạo | Phải là MySQL/database/project riêng, chỉ synthetic data, user/password riêng, không import production dump. |
| CV upload | Conditional | PDF/DOCX, tối đa 5 MB, signature/ZIP checks, tên random; download có authorization. Cần volume/backup/restart test. |
| Logo upload | Conditional | JPG/PNG, tối đa 2 MB, signature check, public qua `/assets/logos`; cần cùng persistent volume. |
| Email | Chưa xác minh | Dùng SMTP sandbox; khi thiếu SMTP, app không gửi mail và không log reset token. Không gửi tới người dùng thật. |
| Cron | Risk | Worker chạy trong process; nhiều replica có thể gửi trùng. Staging giữ `ALERT_WORKER_ENABLED=false`, chạy one-off hoặc đúng một worker. |
| Gemini | Conditional | Key chỉ ở backend. Model `gemini-3.6-flash` vẫn là stable previous-generation; phải smoke test quota/model. V2 embedding legacy không dùng trong demo. |
| Logs | Partial | Có request ID và access log không ghi query string; lỗi 5xx không lộ nội dung. Chưa có JSON log, retention hoặc error tracker tập trung. |
| Health | Improved | `/api/health/live` kiểm process; `/api/health/ready` kiểm MySQL và trả 503 khi DB lỗi. |
| SPA deep links | **Blocker cấu hình host** | Vite build được, nhưng platform cần rewrite fallback sau các rule `/api` và `/assets`. |
| Demo accounts | Prepared, chưa chạy | `db:seed:staging` tạo Candidate/Recruiter/Admin synthetic và không in password; có guardrail DB name + deploy env. |

## 3. Environment contract

### Backend bắt buộc

| Biến | Giá trị staging / quy tắc |
|---|---|
| `NODE_ENV` | `production` để bật Secure cookie và validation production |
| `DEPLOY_ENV` | `staging` |
| `PORT` | Port do platform cấp; app đã đọc biến này |
| `DATABASE_URL` | MySQL staging riêng; ưu tiên private network; không dùng account production |
| `JWT_SECRET` | Random ≥32 ký tự, tốt nhất 64 byte; lưu secret manager |
| `JWT_ISSUER`, `JWT_AUDIENCE` | Giữ ổn định giữa các deploy staging |
| `CORS_ORIGINS` | Chỉ frontend HTTPS chính xác, nhiều origin phân cách dấu phẩy |
| `FRONTEND_URL` | Frontend HTTPS; dùng tạo link email |
| `API_PUBLIC_URL` | Với same-origin reverse proxy, dùng frontend HTTPS; nếu API public riêng, dùng API HTTPS |
| `REFRESH_COOKIE_SAME_SITE` | `strict` cho same-origin/same-site; `none` chỉ khi buộc dùng cross-site HTTPS |
| `TRUST_PROXY` | `true` chỉ khi chạy sau proxy đáng tin và đã test client IP/rate limit |
| `UPLOADS_DIRECTORY` | Ví dụ `/data/resumes` trên persistent volume |
| `LOGOS_DIRECTORY` | Ví dụ `/data/logos` trên cùng persistent volume |

### Tích hợp tùy chọn

- SMTP: đủ `SMTP_HOST/PORT/SECURE/USER/PASSWORD/FROM`, dùng Mailtrap sandbox ở staging.
- Cron: mặc định `ALERT_WORKER_ENABLED=false`; chỉ bật trên đúng một instance sau test.
- Gemini: `GEMINI_API_KEY` trong secret manager; giữ model được xác minh trong AI Studio; timeout/retry đã có.
- V2 embedding `text-embedding-004` là legacy và không được đưa vào luồng demo. V3 hiện dùng cho shadow/offline.
- Frontend: ưu tiên để `VITE_API_URL` và `VITE_ASSET_URL` rỗng khi dùng reverse proxy same-origin.

Không prefix secret bằng `VITE_`: mọi biến `VITE_*` được đóng gói vào JavaScript client.

## 4. Database và migration

### Phát hiện

- Có 14 migration tăng dần, nhưng không có migration tạo các bảng nền ban đầu.
- `prisma migrate status` trên database development ngày 2026-11-04 thấy **cả 14 migration đều chưa được
  ghi nhận đã áp dụng**, dù ứng dụng/database hiện đã có schema tương ứng do workflow `db push`. Vì vậy tuyệt
  đối không chạy `migrate deploy` trực tiếp lên database này; sẽ có xung đột hoặc lặp data transform.
- Migration `20261026120000_add_employment_type_enum` có data transform đặt giá trị employment type không hợp
  lệ thành `NULL`; phải backup và kiểm tra dữ liệu trước khi chạy.
- `migrate deploy` của Prisma 6 là lệnh đúng cho staging/production; nó không tạo migration, không reset DB,
  không dùng shadow database và không phát hiện mọi schema drift. Xem
  [Prisma v6 development and production](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production).

### Điều kiện GO

Tạo baseline migration từ schema ở commit nền `07fef94` (đã có `tokenVersion` nhưng chưa có các thay đổi của
14 migration hiện tại), đặt timestamp trước migration hiện có, rồi chứng
minh một MySQL database hoàn toàn trắng có thể chạy toàn bộ `npm run db:migrate:deploy` đến schema hiện tại.
Không dùng `prisma db push` để lách migration history.

Rollback:

- trước migration: `mysqldump --single-transaction --routines --triggers` và kiểm tra file restore được;
- nếu app lỗi nhưng schema backward-compatible: rollback app về deployment trước;
- nếu migration đã thành công: tạo migration fix-forward/revert có review, hoặc restore sang DB mới rồi đổi
  `DATABASE_URL`; không sửa/xóa migration đã áp dụng;
- nếu migration thất bại một phần: đọc `_prisma_migrations.logs`, hoàn tác bước đã chạy, sau đó mới dùng
  `prisma migrate resolve --rolled-back <migration>` theo
  [Prisma v6 production recovery](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/patching-and-hotfixing).

## 5. Upload và dữ liệu sau restart

CV nằm ngoài `/assets` và chỉ tải qua endpoint có authorization. Đây là thiết kế đúng. Logo là public asset.
Rủi ro còn lại:

- filesystem mặc định của nhiều PaaS là ephemeral;
- DB row và file không cùng transaction; backup/restore phải phối hợp cả MySQL và volume;
- xóa CV sẽ xóa file dù application có `resumePathSnapshot`, nên recruiter có thể mất bản CV sau khi
  candidate xóa resume; không dùng dữ liệu thật trong staging và ghi rõ hạn chế demo;
- một volume thường chỉ gắn một replica, vì vậy staging chỉ chạy một backend replica.

Trên Render, filesystem mặc định là ephemeral và persistent disk chỉ có trên paid service
([Render disks](https://render.com/docs/disks)). Trên Railway, volume tồn tại qua deploy/restart và có lịch
backup ([Railway databases and volumes](https://docs.railway.com/databases)).

## 6. Email, cron và AI

- Staging dùng Mailtrap Email Sandbox để chặn email; free plan tồn tại nhưng có giới hạn thấp
  ([Mailtrap pricing](https://mailtrap.io/pricing/)).
- Chạy `npm run worker:alerts:once` sau khi tạo một alert synthetic; không bật cron mỗi phút trong lúc bảo vệ.
- Nếu dùng cron trong API, chỉ một replica được bật worker. Chưa có distributed lock.
- Gemini key không được đưa vào frontend/log. Google yêu cầu giữ key server-side và dùng secret store
  ([Gemini API key security](https://ai.google.dev/gemini-api/docs/api-key)).
- Free Gemini tier có quota thay đổi và dữ liệu có thể được dùng để cải thiện sản phẩm; chỉ gửi CV synthetic,
  không gửi CV thật. Rate limit thực tế phải kiểm tra trong AI Studio
  ([Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)).
- `gemini-3.6-flash` hiện là stable previous-generation; không tự đổi model ngay trước demo. Đổi model là một
  thay đổi cần smoke/regression test.

## 7. Hosting và chi phí dự kiến

### Khuyến nghị cho demo: Vercel + Railway

- Vercel Hobby host Vite static, có SPA rewrite và reverse proxy `/api` + `/assets` về Railway. Hobby hiện
  $0/tháng cho project cá nhân/non-commercial ([Vercel Hobby](https://vercel.com/docs/plans/hobby)).
- Railway chạy một backend service, một MySQL service và persistent volumes. Free tier hiện bắt đầu $0,
  sau trial là $1/tháng với giới hạn nhỏ; Hobby có mức sử dụng tối thiểu $5 và $5 credit
  ([Railway pricing](https://railway.com/pricing)). MySQL template là single node và backup phải bật riêng
  ([Railway MySQL](https://docs.railway.com/databases/mysql)).
- Reverse proxy same-origin giữ cookie `SameSite=Strict` và tránh phụ thuộc third-party cookies.

Ước tính demo nhỏ: **$5–15/tháng** trên Railway tùy thời gian chạy, RAM/CPU, MySQL, volume và network;
Vercel/Mailtrap/Better Stack/Gemini có thể $0 trong free limits. Đây không phải báo giá; đặt spending alert và
tắt tài nguyên sau bảo vệ.

| Dịch vụ | Dự kiến | Ghi chú |
|---|---:|---|
| Vercel Hobby | $0 | Cá nhân, non-commercial; SPA/static frontend |
| Railway backend + MySQL + volumes | khoảng $5–15 | Hobby tối thiểu $5; usage vượt credit tính thêm |
| Mailtrap Sandbox | $0 | Chỉ email test, không gửi user thật |
| Better Stack | $0 | Free plan có uptime monitors/log quota nhỏ ([pricing](https://betterstack.com/pricing)) |
| Gemini | $0 trong free quota | Chỉ synthetic data; đặt quota/billing alert |
| Cloudflare R2 (tùy chọn tương lai) | $0 trong 10 GB free tier | Cần đổi code sang object storage; chưa sẵn sàng ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)) |

### Phương án khác

- Render free phù hợp preview nhưng spin-down sau 15 phút và không có persistent disk free; không phù hợp CV
  persistence ngày bảo vệ ([Render free limitations](https://render.com/docs/free)).
- Một VPS nhỏ có thể gom frontend/backend/MySQL/storage nhưng tăng đáng kể rủi ro vận hành, backup, firewall,
  TLS và single point of failure; không khuyến nghị nếu nhóm chưa quen Linux operations.

## 8. Logs, health và monitoring

- Dùng `/api/health/live` cho liveness; `/api/health/ready` cho deploy/readiness monitor.
- Không gửi query string vào access log, tránh lộ reset/unsubscribe token; request ID được phản hồi qua header.
- Host log retention hiện là nguồn log chính. Chưa có structured JSON, trace hay Sentry SDK.
- Cấu hình một external uptime monitor cho readiness, cảnh báo email; không để monitor chứa credential.
- Theo dõi 5xx, 429, DB connection error, Gemini timeout/quota, SMTP failure và disk usage.
- Không log request body, Authorization, Cookie, CV text, Gemini key, password/reset token.

## 9. Rủi ro ưu tiên và rollback

| Rủi ro | Mức | Giảm thiểu | Rollback |
|---|---|---|---|
| Clean DB không chạy được migration | Critical | Tạo/test baseline trước deploy | Dừng release; không dùng `db push` |
| CV/logo mất sau restart | Critical | Persistent volume + restart smoke + backup | Restore volume/file backup; đối chiếu DB rows |
| Cookie refresh hỏng do cross-site | High | Same-origin proxy; Strict cookie | Rollback frontend/proxy config; không hạ Secure |
| Cron gửi trùng | High | Một worker, mặc định disabled, one-off test | Disable worker và restart; kiểm tra notifications |
| Admin demo bị lộ | Critical | Secret manager, admin password riêng, không đưa checklist công khai | Rotate password, increment tokenVersion/revoke tokens, disable account |
| Migration làm mất dữ liệu employment type | High | Preflight query + dump | Restore DB mới hoặc fix-forward |
| Gemini quota/model lỗi | Medium | Synthetic smoke, timeout/retry, UI fallback | Tắt AI demo; dùng chức năng thủ công/V1 |
| PaaS cold start/quá tải | Medium | Rehearsal, warm-up hợp lệ, paid Hobby ngày bảo vệ | Chuyển sang deployment trước/backup local demo |

## 10. Tiêu chí GO cuối cùng

Chỉ chuyển sang GO khi: baseline migration pass trên DB trắng; backup restore drill pass; upload/logo còn sau restart;
deep-link refresh pass; Secure/HttpOnly/SameSite cookie đúng; Candidate/Recruiter/Admin synthetic đăng nhập được;
admin credential không public; SMTP sandbox, cron one-off, Gemini và monitoring pass; không có secret trong Git;
và người dùng xác nhận rõ việc tạo tài nguyên/deploy.

## 11. Bằng chứng kiểm tra tại máy

- Backend syntax checks: pass.
- Backend unit: **48/48 pass**.
- Backend integration/security/routes: **30/30 pass**.
- Prisma status (read-only): chạy được; xác nhận 14/14 migration chưa được ghi nhận trên development DB.
- Frontend production build: pass, 640 modules; các route lazy sinh chunk riêng.
- Frontend lint: exit code 0 nhưng còn 11 cảnh báo `react(set-state-in-effect)`; không chặn build nhưng nên dọn
  sau buổi bảo vệ.
- Chưa thể xác minh HTTPS, proxy rewrite, cookie thực, persistence sau restart hoặc monitoring vì chưa deploy.

