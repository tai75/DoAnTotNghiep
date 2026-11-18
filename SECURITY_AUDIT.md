# Security Audit — Job Connect

**Ngày audit:** 2026-11-04  
**Phạm vi:** `back-end` (Node.js/Express/Prisma/MySQL), `front-end-web` (React/Vite), JWT access token trong memory, refresh token HttpOnly cookie, upload CV, messaging, matching/Gemini AI.  
**Phương pháp:** review mã nguồn và cấu hình, truy vết data flow/authorization, tìm kiếm static các API nguy hiểm/raw SQL/secrets, chạy test không phá hoại và `npm audit`. Không gọi Gemini, không gửi CV/PII ra ngoài, không đọc/in giá trị trong `.env`, không kết nối hay thay đổi database production.

## Kết luận điều hành

Không phát hiện Critical, SQL injection/raw SQL, secret thật trong source hiện tại, access token lưu ở browser storage, hay IDOR xuyên tenant rõ ràng trong các luồng hồ sơ/đơn ứng tuyển/CV/messaging đã kiểm tra. Các ownership check quan trọng chủ yếu được thực hiện đúng ở backend.

Tuy nhiên có 4 vấn đề High cần ưu tiên trước production:

1. Logout có thể chỉ xóa state frontend nhưng không thu hồi refresh token nếu access token đã hết hạn.
2. API công khai làm lộ `idealAnswer` và `isKnockout` của câu hỏi sàng lọc.
3. Bất kỳ người dùng Internet nào cũng có thể tự cấp vai trò recruiter và tạo công ty chưa xác minh.
4. Nội dung CV/hồ sơ có thể được gửi nguyên văn tới Gemini mà chưa có cơ chế consent/redaction/data-governance thể hiện trong sản phẩm.

### Tổng hợp phát hiện đã xác minh

| ID | Mức độ | Trạng thái | Vấn đề |
|---|---|---|---|
| JC-01 | High | Đã xác minh từ mã | Logout thất bại khi access token hết hạn, refresh session vẫn còn hiệu lực |
| JC-02 | High | Đã xác minh từ mã | Lộ đáp án/tiêu chí knockout của screening question qua API công khai |
| JC-03 | High | Đã xác minh từ mã | Recruiter/company tự đăng ký không qua xác minh, mở đường cho giả mạo nhà tuyển dụng |
| JC-04 | High | Đã xác minh data flow | CV và dữ liệu hồ sơ được gửi tới Gemini không có consent/redaction thể hiện trong mã |
| JC-05 | Medium | Đã xác minh từ mã | Kiểm soát quota/timeout AI không đồng nhất và chỉ lưu trong memory |
| JC-06 | Medium | Đã xác minh pattern; chưa khai thác | CV/job/user text được ghép trực tiếp vào prompt, có rủi ro prompt injection |
| JC-07 | Medium | Đã xác minh control gap; chưa chứng minh exploit parser | Upload CV thiếu AV/sandbox, parse file đồng bộ trong process API |
| JC-08 | Medium | Đã xác minh từ mã | Rate limit/login brute force dùng memory và chủ yếu theo IP |
| JC-09 | Medium | Đã xác minh từ mã | Mô tả công việc không có giới hạn độ dài/quota business |
| JC-10 | Medium | Đã xác minh từ mã | Thiếu audit trail cho đăng nhập và truy cập dữ liệu tuyển dụng nhạy cảm |
| JC-11 | Medium | Đã xác minh từ mã | Unsubscribe dùng GET thay đổi trạng thái và token không hết hạn |
| JC-12 | Low | Đã xác minh từ mã | Một số lệnh gọi Gemini đặt API key trong query string |
| JC-13 | Low | Đã xác minh từ mã | Response cấp token chưa đặt `Cache-Control: no-store` rõ ràng |

Ngoài ra có 3 rủi ro kiến trúc cần xác nhận, được tách riêng ở cuối báo cáo và không khẳng định là lỗ hổng.

## Phát hiện chi tiết

### JC-01 — Logout có thể không thu hồi refresh session

**Mức độ:** High  
**OWASP:** A07 Identification and Authentication Failures  
**Liên quan:** `POST /api/auth/logout`; `back-end/src/routes/auth.routes.js:341-347`; `front-end-web/src/services/api.js:63-70,95-100`; `front-end-web/src/context/AuthContext.jsx:53-60`.

**Bằng chứng đã sanitize:** Route logout bắt buộc `authenticate`, trong khi client cố ý không auto-refresh cho mọi URL bắt đầu bằng `/auth/`. Nếu access token 15 phút đã hết hạn, logout nhận 401; frontend vẫn xóa state local trong `finally`, nhưng không thể xóa HttpOnly cookie và server không revoke refresh token. Không có token/secret thật nào được sử dụng hoặc ghi lại khi xác minh.

**Tác động:** Người dùng nhận cảm giác đã logout nhưng tải lại trang có thể khôi phục phiên bằng refresh cookie còn hiệu lực; rủi ro rõ hơn trên máy dùng chung hoặc khi refresh token đã bị sao chép.

**Tái hiện an toàn:** Trong test adapter/local test account, đăng nhập; dùng access token đã hết hạn nhưng giữ refresh cookie; gọi `POST /api/auth/logout`; xác nhận 401, sau đó gọi `POST /api/auth/refresh` với cùng cookie và xác nhận phiên vẫn được cấp lại. Không thực hiện trên tài khoản production.

**Khắc phục:** Cho logout xử lý refresh cookie độc lập với access token: luôn clear cookie; hash cookie và revoke đúng refresh-token record/current token family bằng transaction. Có thể dùng optional authentication để ghi nhận user nếu access token còn hợp lệ. Nếu hỗ trợ “logout all devices”, cung cấp endpoint riêng có re-authentication; không vô tình revoke tất cả phiên khi người dùng chỉ logout một thiết bị.

### JC-02 — Lộ đáp án và tiêu chí loại của câu hỏi sàng lọc

**Mức độ:** High  
**OWASP:** A01 Broken Access Control / rủi ro gian lận tuyển dụng  
**Liên quan:** `GET /api/jobs/:id/screening-questions`; `back-end/src/routes/jobs.routes.js:256-263`; model `JobScreeningQuestion` trong `back-end/prisma/schema.prisma`.

**Bằng chứng đã sanitize:** Endpoint không yêu cầu authentication và trả trực tiếp toàn bộ `screeningQuestions`. Prisma model chứa cả `idealAnswer` và `isKnockout`, không có `select` loại bỏ hai trường này. Không cần truy cập dữ liệu thật để xác minh data-flow.

**Tác động:** Ứng viên có thể biết đáp án mong muốn và tiêu chí knockout trước khi nộp, làm sai lệch screening và chất lượng tuyển dụng.

**Tái hiện an toàn:** Tạo fixture job local với câu hỏi và giá trị giả như `idealAnswer="[TEST]"`; gọi GET endpoint không kèm token; kiểm tra response hiện chứa trường này. Không dùng job/đáp án production.

**Khắc phục:** Public DTO chỉ trả `id`, `type`, `question`, `options`, `isRequired`; không trả `idealAnswer`, `isKnockout` hoặc moderation/internal scoring metadata. Áp dụng DTO tương tự khi candidate đọc chi tiết đơn ứng tuyển. Thêm regression test khẳng định các trường nội bộ không xuất hiện.

### JC-03 — Tự cấp recruiter/company không qua xác minh

**Mức độ:** High  
**OWASP:** A04 Insecure Design / abuse case đặc thù tuyển dụng  
**Liên quan:** `POST /api/auth/register`; `back-end/src/routes/auth.routes.js:29-40,220-243`; `GET /api/recruiters/talent`; `POST /api/recruiters/talent/invite`.

**Bằng chứng đã sanitize:** Schema đăng ký cho phép client chọn `RECRUITER`. Backend lập tức tạo `Company` và `Recruiter`, phát access/refresh token, không có email verification, company-domain verification hay admin approval. Recruiter sau đó có thể duyệt hồ sơ `isSearchable` và gửi invitation.

**Tác động:** Giả mạo doanh nghiệp, thu thập thông tin nghề nghiệp, spam/phishing ứng viên và làm giảm niềm tin của nền tảng. Việc chỉ ẩn email/phone trước application/accepted invitation là giảm thiểu tốt nhưng không loại bỏ rủi ro social engineering.

**Tái hiện an toàn:** Viết integration test với domain `.test`: đăng ký recruiter/công ty giả, rồi xác nhận account mới có thể gọi talent search và invite. Không gửi invitation thật.

**Khắc phục:** Thêm trạng thái recruiter/company `PENDING_VERIFICATION`; xác minh email và domain doanh nghiệp; duyệt thủ công/đối soát doanh nghiệp trước khi mở talent search, CV, messaging hoặc invite; rate limit invitation và thêm report/block abuse. Không dựa vào frontend để khóa quyền.

### JC-04 — Gửi CV/PII tới Gemini thiếu consent và data minimization

**Mức độ:** High  
**OWASP:** A02 Cryptographic Failures (data exposure), A04 Insecure Design; privacy/AI governance  
**Liên quan:** `POST /api/candidates/me/resumes/:id/import`; `POST /api/candidates/me/job-analysis/:jobId`; `GET /api/jobs/:id/match/v2`; `back-end/src/routes/candidates.routes.js:426-429,531-550`; `back-end/src/services/llm.service.js:94-110,142-163`; `back-end/src/services/matching.service.js:184-193,223-253`.

**Bằng chứng đã sanitize:** Text trích từ CV (tối đa 30.000 ký tự) được nội suy vào request Gemini. Matching V2 gửi `headline`, `bio`, học vấn, kinh nghiệm và dự án để tạo embedding. Không thấy bước phát hiện/redact email, số điện thoại, địa chỉ, identifier; không thấy consent/version policy hoặc cơ chế opt-out. Audit không gọi Gemini và không gửi PII ra ngoài.

**Tác động:** CV thường chứa dữ liệu cá nhân và dữ liệu nhạy cảm. Việc chuyển sang bên xử lý thứ ba có thể vi phạm thông báo quyền riêng tư, mục đích xử lý, lưu trú dữ liệu hoặc chính sách của doanh nghiệp.

**Tái hiện an toàn:** Unit test mock `fetch`, dùng CV tổng hợp chứa marker `[PII_TEST]`; gọi service và xác nhận marker xuất hiện trong body mock. Không dùng người thật và chặn network.

**Khắc phục:** Hiển thị consent rõ ràng trước lần gửi đầu; công bố nhà cung cấp/mục đích/retention; redact contact details và chỉ gửi trường tối thiểu; cho phép xử lý local/manual; cấu hình provider không dùng dữ liệu để huấn luyện nếu gói dịch vụ hỗ trợ; đặt retention/deletion/DPA và data-region; log sự kiện consent nhưng không log nội dung CV.

### JC-05 — Quota, timeout và cost control AI chưa đồng nhất

**Mức độ:** Medium  
**OWASP:** A04 Insecure Design / API resource consumption  
**Liên quan:** `GET /api/jobs/:id/match/v2`; `GET /api/recommendations/jobs`; các endpoint `/api/ai`; `back-end/src/services/llm.service.js:4-6,40-76`; `back-end/src/services/matching.service.js:223-244`; `back-end/src/routes/jobs.routes.js:178-191`.

**Bằng chứng đã sanitize:** Counter `requestCounts` là `Map` trong từng process và reset khi restart/scale-out. `/match/v2` không dùng AI limiter riêng, gọi legacy embedding endpoint không có `AbortController`; retry của generative AI có thể nhân đôi chi phí. Global limiter 300 request/15 phút không phải budget control theo user/model/token.

**Tác động:** Người dùng đã xác thực có thể gây tăng chi phí, cạn quota hoặc giữ connection/process chờ provider. Scale nhiều instance làm quota hiệu dụng tăng theo số instance.

**Tái hiện an toàn:** Mock `fetch` và clock; gọi endpoint/service lặp lại trong test để đếm số outbound call; mô phỏng promise không resolve để chứng minh legacy embedding không timeout. Không gọi provider thật.

**Khắc phục:** Dùng distributed limiter (Redis/database) theo `userId + capability`, quota ngày/tháng và budget toàn hệ thống; timeout/circuit breaker cho mọi outbound call; giới hạn concurrency; cache/idempotency; `maxOutputTokens`; metric/cảnh báo chi phí; fail closed khi budget hết.

### JC-06 — Prompt injection qua CV/job/user content

**Mức độ:** Medium  
**OWASP:** A04 Insecure Design; OWASP LLM01 Prompt Injection  
**Liên quan:** `back-end/src/services/llm.service.js:78-82,94-110,121-136,142-169,178-200`.

**Bằng chứng đã sanitize:** CV, job description và chat message được ghép vào cùng một user prompt với instruction. Không có system/developer separation, delimiter contract mạnh, content classification hay prompt-injection detection. Output import/analysis được Zod validate và tool allowlist được scope theo role—đây là giảm thiểu tốt—nhưng validation chỉ bảo đảm hình dạng, không bảo đảm tính trung thực của nội dung.

**Tác động:** CV độc hại có thể cố làm model tạo headline/skills/suggestion sai, thao túng đánh giá hoặc tiêu tốn tool turns. Chưa thấy đường prompt injection vượt authorization hoặc đọc cross-tenant; vì vậy không xếp High.

**Tái hiện an toàn:** Với mock model, dùng CV synthetic chứa “ignore previous instructions” và trả JSON hợp schema nhưng sai nội dung; xác nhận Zod vẫn chấp nhận. Không gửi prompt ra ngoài.

**Khắc phục:** Tách instruction ở system role; đóng gói dữ liệu không tin cậy bằng structured parts/delimiters; nói rõ tài liệu là data, không phải instruction; validate theo nguồn (ví dụ skill phải có bằng chứng); giữ bước user review trước import; không cho model quyết định tuyển dụng; log/flag anomalous outputs; giữ authorization hoàn toàn ngoài model.

### JC-07 — Upload CV còn rủi ro parser/malware và lưu trữ

**Mức độ:** Medium  
**OWASP:** A04 Insecure Design / A05 Security Misconfiguration  
**Liên quan:** `POST /api/candidates/me/resumes`; download/import CV; `back-end/src/routes/candidates.routes.js:134-210,316-343,621-680`.

**Bằng chứng đã sanitize:** Kiểm soát hiện có khá tốt: chỉ PDF/DOCX, tối đa 5 MB, tên file random, đối chiếu MIME/extension/signature, giới hạn ZIP entry/uncompressed size và lưu ngoài `/assets`. Tuy nhiên file được `readFileSync` rồi parse bằng `pdf-parse`/`mammoth` ngay trong API process; không có AV/CDR, sandbox/worker isolation, timeout CPU hoặc chính sách encryption/retention thể hiện trong repo. Chưa chứng minh được exploit cụ thể trong parser.

**Tác động:** File crafted có thể gây CPU/memory exhaustion hoặc khai thác parser khi dependency có lỗi mới; malware có thể được nền tảng phân phối lại cho recruiter dù dùng `attachment`.

**Tái hiện an toàn:** Chỉ dùng fixtures synthetic trong unit test để đo thời gian/bộ nhớ và reject malformed/oversized archive; không fuzz production và không tải malware thật.

**Khắc phục:** Upload vào quarantine object storage; scan AV/CDR; parse trong worker/container giới hạn CPU/RAM/time; re-validate sau scan; mã hóa at rest, retention/deletion policy; không dùng sync I/O trong request path; thêm upload/import limiter theo user. Giữ `Content-Disposition: attachment` và `X-Content-Type-Options: nosniff`.

### JC-08 — Rate limit/brute force chỉ theo IP và memory

**Mức độ:** Medium  
**OWASP:** A07 Identification and Authentication Failures  
**Liên quan:** `back-end/src/app.js:43-49`; `back-end/src/routes/auth.routes.js:14-27,246-303`; `TRUST_PROXY` trong `back-end/src/config/env.js`.

**Bằng chứng đã sanitize:** `express-rate-limit` dùng store mặc định trong memory. Auth limit 10/15 phút chủ yếu theo IP, dùng chung cho register/login/password-reset. Không có limiter bổ sung theo normalized email/account, exponential backoff hoặc risk signal. Response login không phân biệt user tồn tại—đây là kiểm soát tốt.

**Tác động:** Botnet/proxy rotation có thể brute-force một account; nhiều instance làm tăng ngưỡng; người dùng chung NAT có thể chặn lẫn nhau. Cấu hình `trust proxy` sai có thể làm key IP không đúng.

**Tái hiện an toàn:** Integration test với fake IP headers chỉ khi test app cấu hình trusted proxy; không thử password thật và không tạo tải lớn.

**Khắc phục:** Redis-backed limiter; kết hợp key IP + HMAC(normalized email); backoff/temporary challenge theo account nhưng tránh lockout DoS; MFA cho admin và recruiter nhạy cảm; alert credential stuffing; xác minh chain proxy và chỉ bật `TRUST_PROXY` khi proxy ghi đè header.

### JC-09 — Thiếu giới hạn độ dài mô tả công việc và quota tạo dữ liệu

**Mức độ:** Medium  
**OWASP:** A04 Insecure Design / resource consumption  
**Liên quan:** `POST /api/jobs`, `PATCH /api/jobs/:id`, `/api/jobs/ai-description`; `back-end/src/routes/jobs.routes.js:35-48,288-329`; `express.json({limit:'2mb'})`.

**Bằng chứng đã sanitize:** `description` chỉ có `.min(20)` mà không có `.max(...)`. Recruiter tự đăng ký có thể tạo nhiều job; không thấy quota theo company. Giới hạn body 2 MB và global rate limit chỉ giảm thiểu phần nào.

**Tác động:** Tăng dung lượng DB, kích thước response/search và chi phí AI/embedding; có thể gây suy giảm dịch vụ bằng tài khoản hợp lệ.

**Tái hiện an toàn:** Unit test schema với chuỗi giả vượt ngưỡng mong muốn; không ghi DB production.

**Khắc phục:** Đặt max hợp lý (ví dụ 20–50 KB tùy business), giới hạn số job draft/pending/active theo company, pagination và quota; giới hạn output AI trước khi trả/lưu.

### JC-10 — Thiếu audit trail cho truy cập dữ liệu nhạy cảm

**Mức độ:** Medium  
**OWASP:** A09 Security Logging and Monitoring Failures  
**Liên quan:** CV download, talent search, application read/status, auth login/refresh/logout; `back-end/src/routes/admin.routes.js:180-198,234-281`.

**Bằng chứng đã sanitize:** `AuditLog` hiện chủ yếu được ghi cho một số thao tác moderation/status của admin. Không thấy event cho login failure/success, refresh replay, CV download, recruiter đọc application/contact, talent invite hoặc export-like access. Morgan chỉ ghi method/path/status và cố ý không ghi token/query—đây là lựa chọn an toàn.

**Tác động:** Khó điều tra hành vi thu thập CV, insider abuse, account takeover và khiếu nại privacy.

**Tái hiện an toàn:** Test mock `auditLog.create` khi gọi các endpoint nhạy cảm và xác nhận hiện chưa có event; không cần dữ liệu thật.

**Khắc phục:** Ghi event có actor, tenant/company, action, resource ID, outcome, request ID, timestamp; không ghi CV content, token, password, raw prompt hay contact details. Bảo vệ log khỏi sửa, có retention/alert cho tải CV hàng loạt, refresh replay và login failure bất thường.

### JC-11 — Unsubscribe bằng GET và token không hết hạn

**Mức độ:** Medium  
**OWASP:** A04 Insecure Design  
**Liên quan:** `GET /api/candidates/alerts/unsubscribe`; `back-end/src/routes/candidates.routes.js:86-94`; `back-end/src/jobs/alertWorker.js`.

**Bằng chứng đã sanitize:** GET làm thay đổi `isActive=false`. Token là HMAC ổn định chỉ từ `alertId`, dùng chung `JWT_SECRET`, không có expiry/nonce. Link nằm trong email/query string. Link scanner, preview bot, browser prefetch hoặc link bị forward có thể vô hiệu hóa alert.

**Tác động:** Ứng viên ngừng nhận cơ hội việc làm ngoài ý muốn; link bị lộ có hiệu lực vô thời hạn.

**Tái hiện an toàn:** Với fixture và test secret, sinh link local; gọi GET một lần và xác nhận state đổi. Không dùng alert production.

**Khắc phục:** Dùng key riêng có rotation, token ngẫu nhiên/hash trong DB hoặc signed payload gồm user/alert/expiry/purpose; GET chỉ hiển thị trang xác nhận, POST mới thay đổi trạng thái. Nếu cần one-click email chuẩn, triển khai cơ chế POST phù hợp và chống scanner/replay.

### JC-12 — Gemini API key trong query string

**Mức độ:** Low  
**OWASP:** A02 Cryptographic Failures / secret handling  
**Liên quan:** `back-end/src/services/llm.service.js:52-64`; legacy embedding tại `back-end/src/services/matching.service.js:231-236`.

**Bằng chứng đã sanitize:** Key được nối vào URL `?key=...`; giá trị không được in trong audit. V3 embedding đã dùng header `x-goog-api-key`, cho thấy có mẫu an toàn hơn trong cùng repo.

**Tác động:** URL dễ lọt vào proxy/APM/trace hơn header, dù request dùng HTTPS và app hiện không log outbound URL.

**Tái hiện an toàn:** Mock `fetch`; chỉ kiểm tra URL chứa tên tham số `key`, không ghi giá trị.

**Khắc phục:** Gửi key bằng header được provider hỗ trợ; cấu hình redaction query/header trong APM; giới hạn API key theo API, project/quota và egress nếu có thể.

### JC-13 — Token response thiếu chỉ thị không cache

**Mức độ:** Low  
**OWASP:** A05 Security Misconfiguration  
**Liên quan:** login/register/refresh; `back-end/src/routes/auth.routes.js:220-266`; `back-end/src/app.js`.

**Bằng chứng đã sanitize:** Access token được trả trong JSON nhưng không thấy `Cache-Control: no-store`/`Pragma: no-cache` đặt cho response auth. Access token chỉ được giữ trong biến module frontend, không dùng `localStorage`/`sessionStorage`—đây là kiểm soát tốt.

**Tác động:** Giảm defense-in-depth trước browser/intermediary/service worker cache sai cấu hình.

**Tái hiện an toàn:** Supertest login bằng fixture và kiểm tra header, không in body/token.

**Khắc phục:** Đặt `Cache-Control: no-store` cho mọi response chứa token và dữ liệu auth nhạy cảm; cân nhắc `Pragma: no-cache` cho client cũ.

## Rủi ro cần xác nhận (không khẳng định là lỗ hổng)

### RA-01 — MFA cho tài khoản đặc quyền

**Mức rủi ro:** Medium, giả định. Không thấy MFA/WebAuthn/TOTP trong repo. Nếu IdP/WAF bên ngoài đã bắt buộc MFA thì rủi ro được giảm. Admin có quyền xem PII và khóa tài khoản; recruiter truy cập hồ sơ ứng viên, nên MFA nên bắt buộc ít nhất cho admin và recruiter.

### RA-02 — Ranh giới giữa các recruiter cùng công ty

**Mức rủi ro:** Medium, phụ thuộc business rule. Backend cố ý scope nhiều tài nguyên theo `companyId`, vì vậy recruiter cùng công ty có thể xem job/application/conversation và xóa note do recruiter khác tạo. Recruiter khác công ty bị chặn; saved search được scope theo từng user. Nếu yêu cầu thực tế là cô lập từng recruiter thay vì workspace dùng chung, đây là BOLA cần sửa bằng ownership/permission team; nếu công ty là tenant thì hành vi hiện tại phù hợp.

### RA-03 — Security headers/TLS của frontend production

**Mức rủi ro:** Medium, chưa xác minh deployment. API dùng `helmet()` và CORS allowlist chính xác; cookie refresh là `HttpOnly`, `SameSite=Strict`, `Secure` trong production. Tuy nhiên repo không có cấu hình reverse proxy/CDN cho frontend nên chưa xác minh CSP, HSTS, `frame-ancestors`, `Permissions-Policy`, TLS redirect và cache policy trên HTML/static assets. `index.html` tự nó không chứng minh các header bị thiếu ở production.

## Các kiểm soát đã xác minh tốt

- JWT verify cố định `HS256`, kiểm tra issuer/audience/subject, expiration và `tokenVersion`; role được lấy lại từ database chứ không tin hoàn toàn claim.
- Refresh token ngẫu nhiên 48 byte, chỉ lưu SHA-256 hash, cookie `HttpOnly`/`SameSite=Strict`/path hẹp, rotation atomic; phát hiện replay revoke các token đang hoạt động và tăng `tokenVersion`.
- Password dùng bcrypt cost 12; login không tiết lộ email tồn tại; reset token random, hash trong DB, one-time, hết hạn 1 giờ và reset password revoke session.
- CORS dùng exact allowlist, cấm wildcard khi credentials bật. CSRF cho refresh được giảm thiểu bởi SameSite Strict + CORS; các thao tác khác dùng Bearer token, không tự động gửi như cookie.
- Ownership check đã thấy ở candidate resources, saved jobs, alerts, resumes, application, jobs theo company, notifications và conversation participant. Recruiter khác company bị chặn trong các test hiện có.
- Zod được dùng rộng rãi; Prisma parameterized query được dùng nhất quán. Tìm kiếm không thấy `$queryRaw`, `$executeRaw` hay biến thể unsafe.
- Error 5xx được thay bằng thông báo chung; log chỉ gồm request ID, error name, status, không ghi stack/message nhạy cảm. Morgan log path, không log query/Authorization.
- CV không được serve qua static `/assets`; tên lưu random; download có authorization và `attachment`. MIME/extension/signature/size/ZIP structure đều được kiểm tra.
- React không dùng `dangerouslySetInnerHTML`; mặc định escape text. URL do người dùng nhập cho project/company bị giới hạn `http/https`.
- `helmet()` được bật cho API; body JSON giới hạn 2 MB; graceful shutdown có disconnect Prisma.

## Secrets và dependency

### Secrets

- Có file local `back-end/.env`, nhưng audit chỉ xác minh tên file và ignore rule; không đọc hoặc in nội dung.
- `.env`/private keys/uploads/logs được ignore. Chỉ `back-end/.env.example` được track.
- Không thấy blob file `.env` thật trong các revision Git reachable. Các commit có tên biến nhạy cảm chỉ là dấu hiệu thay đổi example/test/config, không phải bằng chứng secret thật từng bị commit.
- Static scan ngoài tests/examples không phát hiện chuỗi giống private key/Gemini key/hardcoded credential. Không tự động rotate credential.

### Dependency scan

Chạy ngày 2026-11-04:

| Project | Lệnh | Kết quả |
|---|---|---|
| Backend | `npm audit --json` | 0 vulnerability (0 Critical/High/Moderate/Low), 301 dependencies được thống kê |
| Backend production | `npm audit --omit=dev --json` | 0 vulnerability, 176 production dependencies |
| Frontend | `npm audit --json` | 0 vulnerability (0 Critical/High/Moderate/Low), 146 dependencies được thống kê |

Kết quả chỉ phản ánh npm advisory tại thời điểm chạy; không thay thế SBOM, SCA liên tục hay review rủi ro parser PDF/DOCX.

## Kiểm thử đã chạy

- `npm test` trong `back-end`: **10 test files, 64/64 tests pass**.
- Test trọng tâm auth/security/integration: **2 files, 17/17 tests pass**.
- Bao phủ hiện có gồm register/login/refresh rotation/logout/access invalidation, role matrix, cross-company IDOR, admin moderation, messaging participant, upload signature, JWT algorithm allowlist, CORS, cookie flags và safe 5xx disclosure.
- Không chạy dynamic pentest, fuzzing file, brute force, malware sample, Gemini request, production database migration hoặc thao tác production.

## Kế hoạch sửa theo ưu tiên

### P0 — Trước khi production hoặc trong 24–48 giờ

1. Sửa logout để revoke bằng refresh cookie ngay cả khi access token hết hạn; thêm test cho đúng tình huống này.
2. Loại `idealAnswer`/`isKnockout` khỏi mọi candidate/public DTO và thêm regression test chống lộ trường nội bộ.
3. Đặt recruiter/company vào trạng thái chưa xác minh; chặn talent search/invite/CV/application access cho đến khi được duyệt.
4. Tạm tắt các luồng gửi CV/profile tới Gemini nếu chưa có consent/privacy terms/DPA; sau đó triển khai redaction và data minimization.

### P1 — Trong sprint kế tiếp

5. Đưa rate limit/quota AI và auth sang store phân tán; thêm account-aware brute-force control, timeout/circuit breaker/concurrency/budget.
6. Cứng hóa prompt và giữ mọi authorization ngoài model; thêm adversarial prompt tests.
7. Đưa parse CV sang worker sandbox/quarantine, thêm AV/CDR và lifecycle/encryption policy.
8. Thêm audit event bảo vệ privacy cho auth, CV download, application/contact read, invitation và refresh replay.
9. Sửa unsubscribe token/purpose/expiry và tránh GET thay đổi trạng thái.
10. Đặt max length/quota cho job description và tài nguyên do recruiter tạo.

### P2 — Defense in depth và production readiness

11. Chuyển Gemini key từ query sang header; đặt `no-store` cho auth responses.
12. Xác nhận mô hình tenant: recruiter cùng công ty có được dùng chung note/conversation/job/application hay không; encode rule thành test.
13. Bắt buộc MFA cho admin/recruiter; hoàn thiện cảnh báo abuse và session/device management.
14. Kiểm tra header/TLS thực tế tại CDN/reverse proxy của cả frontend và API; thiết lập CSP phù hợp React/Vite.
15. Tạo SBOM và chạy SCA/secret scanning trong CI; định kỳ review dependency parser và container image.

## Nguyên tắc triển khai bản sửa

Không nên sửa đồng loạt auth/refresh/role model mà không có migration plan và integration test. Ưu tiên thay đổi nhỏ có contract rõ: DTO allowlist, logout theo current refresh token, feature gate recruiter verification và AI consent. Mỗi thay đổi authorization phải có test positive/negative cho CANDIDATE, recruiter cùng công ty, recruiter khác công ty và ADMIN trước khi deploy.
