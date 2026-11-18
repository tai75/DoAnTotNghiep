# Job Connect Security Hardening Report

Ngày kiểm tra: 2026-11-03  
Phạm vi: `back-end`, cấu hình tích hợp `front-end-web`, Git working tree và Git history.  
Chuẩn tham chiếu: OWASP Top 10 (2021), OWASP ASVS session management và file upload guidance.

## Nguyên tắc và giới hạn

- Đọc mã nguồn thực tế và kiểm tra route/middleware, không chỉ README.
- Không đọc, in hoặc đưa giá trị từ `.env` vào báo cáo.
- Không rotate JWT, database, SMTP hay Gemini secret. Việc rotate cần phối hợp môi trường triển khai.
- Giữ response thành công và cấu trúc API hiện hữu. Một ngoại lệ có chủ đích: API yêu cầu reset mật khẩu không còn trả raw reset token ở môi trường development.
- Repository đã có nhiều thay đổi chưa commit trước đợt hardening. Các thay đổi đó được giữ nguyên.

## Tóm tắt

| ID | Mức | OWASP | Trạng thái | Nội dung |
|---|---|---|---|---|
| SEC-01 | High | A07 | Fixed | Refresh rotation không nguyên tử và không phát hiện replay |
| SEC-02 | High | A02/A09 | Fixed | Reset/unsubscribe token và nội dung email có thể xuất hiện trong log |
| SEC-03 | High | A01 | Fixed | Candidate nhận được recruiter-only application notes |
| SEC-04 | High | A04/A05 | Fixed | Upload dựa quá nhiều vào MIME/extension và DOCX chỉ kiểm tra `PK` |
| SEC-05 | Medium | A07 | Fixed | JWT chưa khóa algorithm/issuer/audience; cookie TTL hard-code |
| SEC-06 | Medium | A01/A05 | Fixed | CORS credentialed chưa từ chối origin ngoài allowlist ở tầng server |
| SEC-07 | Medium | A03/A04 | Fixed | Một số endpoint dùng `Zod.parse` trực tiếp hoặc ép ID bằng `Number` |
| SEC-08 | Medium | A04 | Fixed | Thiếu global/API và AI-specific rate limiting |
| SEC-09 | Medium | A05/A09 | Fixed | Lỗi 500 và logging có thể tiết lộ thông tin nội bộ |
| SEC-10 | Low | A02 | Fixed | `.gitignore` chưa bao phủ env variants và private-key artifacts |

## Bằng chứng trước và sau

### SEC-01 — Refresh token rotation và replay

**Trước:** `/auth/refresh` đọc token, gọi `update` để revoke rồi gọi `createSession` ở thao tác DB riêng. Hai request đồng thời có thể cùng đọc token chưa revoke và tạo hai refresh token. Token đã revoke chỉ trả 401, không thu hồi descendants hoặc access token.

**Sau:** [auth.routes.js](back-end/src/routes/auth.routes.js) dùng `rotateRefreshToken` trong một Prisma transaction:

- claim token bằng `updateMany` với `revokedAt: null` và `expiresAt > now`;
- chỉ một request có thể nhận `count === 1`;
- request thua race hoặc reuse token đã revoke được xem là replay;
- replay thu hồi toàn bộ refresh token còn hoạt động của user và tăng `tokenVersion`, làm access token cũ mất hiệu lực;
- refresh token mới chỉ được tạo sau claim thành công.

**Test:** `rotates a refresh token with an atomic one-time claim` và `treats a failed refresh-token claim as replay...` trong [security.test.js](back-end/tests/security.test.js).

### SEC-02 — Secret/token exposure trong response và log

**Trước:** khi SMTP chưa cấu hình, password-reset route log email và URL chứa raw reset token; mail fallback log người nhận, subject và toàn bộ body, bao gồm unsubscribe token. Development response cũng trả raw reset token.

**Sau:** password reset và mail fallback chỉ ghi thông báo cấu hình chung; error logger không ghi `error.message`; reset endpoint không trả raw token ở bất kỳ environment nào. URL reset sử dụng `config.frontendUrl` và encode token. Không có secret nào được rotate tự động.

### SEC-03 — Broken access control/data exposure

**Trước:** `GET /api/applications/:id` kiểm tra candidate ownership đúng nhưng trả cùng object có `notes` nội bộ như recruiter.

**Sau:** [applications.routes.js](back-end/src/routes/applications.routes.js) dùng `applicationForViewer`; candidate view loại bỏ `notes`, recruiter thuộc đúng company vẫn nhận notes. Admin, recruiter, candidate, notification, conversation và CV endpoints được rà theo role + ownership:

| Nhóm | Guard/ownership chính |
|---|---|
| Admin | `router.use(authenticate, authorize('ADMIN'))` |
| Recruiter tools | router-level recruiter guard; job/application/company đều lọc `companyId` |
| Candidate resources | candidate lấy từ `req.user.id`; resource lookup ghép `candidateId` |
| Applications | candidateId hoặc recruiter companyId |
| Conversations | application candidate userId hoặc job companyId |
| Notifications | mọi read/update/delete đều ghép `userId` |
| CV download | admin, CV owner, hoặc recruiter có application thuộc company |

Admin đổi trạng thái user giờ đồng thời revoke refresh tokens của user đó. Đổi/reset mật khẩu cũng tăng `tokenVersion` và revoke refresh tokens.

**Test:** `does not expose recruiter-only notes in the candidate application view`.

### SEC-04 — File upload

**Trước:** CV đã có giới hạn 5 MB và so MIME/extension, nhưng DOCX chỉ cần hai byte `PK`; file ZIP bất kỳ có thể qua kiểm tra. Không có quota số CV. Logo chỉ tin client MIME.

**Sau:** [candidates.routes.js](back-end/src/routes/candidates.routes.js) và [companies.routes.js](back-end/src/routes/companies.routes.js):

- CV chỉ nhận PDF/DOCX, extension phải khớp MIME, tên lưu trên disk là random;
- PDF cần `%PDF-` và `%%EOF`;
- DOCX cần ZIP local header, central-directory hợp lệ, `[Content_Types].xml` và `word/document.xml`;
- từ chối path traversal entry, Zip64/size không kiểm soát, hơn 2.000 entries hoặc tổng uncompressed size khai báo trên 25 MB;
- tối đa 5 MB/file và 10 CV/candidate;
- chuẩn hóa original filename, bỏ control characters, giới hạn 255 ký tự;
- file bị từ chối hoặc DB lỗi được xóa;
- logo yêu cầu MIME + extension + PNG/JPEG magic bytes, tối đa 2 MB, lưu dưới thư mục public riêng với tên random.

**Test:** PDF/DOCX signature tests trong [routes.test.js](back-end/tests/routes.test.js) và logo signature test trong [security.test.js](back-end/tests/security.test.js).

### SEC-05 — JWT, cookie và CSRF

**Trước:** JWT verify dùng default của thư viện, không yêu cầu issuer/audience/subject; refresh cookie TTL cố định 7 ngày và không dùng `REFRESH_TOKEN_EXPIRES_IN`; `SameSite=Lax`.

**Sau:** JWT chỉ chấp nhận `HS256`, issuer/audience cấu hình và `sub === userId`. Production yêu cầu JWT secret tối thiểu 32 ký tự. Refresh cookie dùng:

- `HttpOnly`;
- `Secure` trong production;
- `SameSite=Strict`;
- `Path=/api/auth`;
- `Max-Age` lấy từ `REFRESH_TOKEN_EXPIRES_IN`.

API dùng bearer access token; refresh là endpoint duy nhất dựa vào cookie. `SameSite=Strict` cộng với server-side exact-origin CORS rejection bảo vệ request trình duyệt cross-site. Nếu production đặt frontend và API ở hai **site** khác nhau, cần thiết kế CSRF token trước khi chuyển sang `SameSite=None`; không nên chỉ đổi cookie flag.

### SEC-06 — CORS và security headers

**Trước:** `cors({ origin: array, credentials: true })` không tự chặn xử lý request server-side từ origin không hợp lệ; cấu hình wildcard không bị fail-fast.

**Sau:** [app.js](back-end/src/app.js) dùng callback exact-origin, trả 403 cho origin ngoài allowlist, giới hạn methods/headers và preflight cache. Cấu hình từ chối wildcard khi credentials bật và chỉ nhận HTTP(S) origins. Helmet vẫn được áp dụng trước routes. `TRUST_PROXY` mặc định tắt và chỉ bật rõ ràng qua environment.

**Test:** allowed origin nhận ACAO phù hợp; attacker origin nhận 403.

### SEC-07 — Input validation và injection surface

**Sau:** bổ sung Zod middleware cho company follow/review IDs, admin review moderation, recruiter talent/search/invite/funnel, candidate invitation response, recommendation và chat/AI payload. URL công ty chỉ nhận `http:`/`https:`. `ZodError` còn phát sinh từ parser nội bộ được map thống nhất về 400 thay vì 500.

Prisma query builder được sử dụng thay cho raw SQL; không tìm thấy `$queryRawUnsafe` hoặc `$executeRawUnsafe`. React render text theo cơ chế escaping mặc định và không tìm thấy `dangerouslySetInnerHTML`; message HTML được strip ở backend. Stored XSS qua company website được giảm bằng HTTP(S)-only validation và link frontend dùng `rel="noreferrer"`.

### SEC-08 — Rate limiting

- Global `/api`: 300 request/15 phút/IP.
- Auth: 10 request/15 phút/IP.
- Refresh: 60 request/15 phút/IP.
- AI: 30 request/giờ/user.
- Messages: 60 message/giờ/user.

Limiters hiện dùng memory store; xem residual risks.

### SEC-09 — Error disclosure và logging

500 response luôn là thông báo chung, không trả `details`; validation 4xx vẫn trả details cần cho client. Internal logger chỉ ghi request ID, error class và status, không ghi error message, request body, Authorization, cookie hoặc query string. Morgan dùng path không có query để unsubscribe/reset-style token không đi vào access log. Request ID do client gửi phải khớp allowlist ký tự và độ dài.

**Test:** secret-like text trong internal exception không xuất hiện ở response hoặc captured log.

### SEC-10 — Secrets và Git history

- `.env` hiện không được Git track; lịch sử tên file chỉ thấy `.env.example`, không thấy `.env` thực.
- Quét toàn bộ patch history bằng các high-confidence patterns cho private key, AWS access key, Gemini-style key, GitHub token và JWT: 0 match.
- `gitleaks` không được cài trong môi trường, nên kết quả regex không thay thế secret scanner chuyên dụng.
- Root/backend/frontend `.gitignore` đã bao phủ `.env`, `.env.*` (trừ `.env.example`), PEM/key/P12/PFX, uploads, logs, dependencies và build output.

Khuyến nghị CI: chạy Gitleaks hoặc tương đương trên full history và pre-receive/pre-commit. Nếu có bất kỳ bằng chứng secret từng rời máy, phối hợp rotate tại secret manager/deployment; không dựa vào việc xóa Git history như biện pháp duy nhất.

## Kiểm thử và xác minh

| Lệnh | Kết quả |
|---|---|
| `npm test` (backend) | 4 files, 33/33 tests pass; gồm 8 security regression tests |
| `npm audit --omit=dev --audit-level=high` (backend) | 0 vulnerabilities |
| `npm audit --omit=dev --audit-level=high` (frontend) | 0 vulnerabilities |
| `npx prisma validate` | Schema hợp lệ |

## Rủi ro còn lại

1. **Rate limit multi-instance:** memory store không chia sẻ giữa replicas và mất state khi restart. Production nhiều instance nên dùng Redis-compatible store và quan sát 429 metrics.
2. **Malware/CDR:** signature và ZIP-structure validation không thay thế antivirus, sandbox hay Content Disarm & Reconstruction. CV parser vẫn chạy trong Node process; production nên scan trước, parse trong worker cô lập với CPU/memory/time limits và object storage private.
3. **Refresh replay trade-off:** phát hiện replay thu hồi mọi phiên của user. Đây là fail-closed nhưng có thể tạo forced logout nếu client không single-flight; frontend hiện đã single-flight refresh.
4. **Cross-site deployment:** `SameSite=Strict` giả định frontend/API cùng site. Kiến trúc cross-site cần CSRF token, `SameSite=None; Secure` và CORS exact-origin; phải test trước khi đổi.
5. **Secret history assurance:** chưa chạy Gitleaks/TruffleHog chuyên dụng. Regex high-confidence không chứng minh tuyệt đối rằng lịch sử chưa từng chứa secret.
6. **Business/runtime findings khác:** migration baseline, Prisma query và matching/cache issues trong `AUDIT_REPORT.md` không thuộc phạm vi security hardening này.
