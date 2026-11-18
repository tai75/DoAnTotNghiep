# AUDIT REPORT — Job Connect

Ngày audit: 2026-11-03  
Phạm vi: `back-end`, `front-end-web`, `docs`, Prisma schema/migrations và cấu hình repository.  
Stack: Node.js, Express, Prisma, MySQL, React, Vite, Gemini AI.

## 1. Phương pháp và giới hạn

- Đọc mã nguồn thực tế của routes, middleware, services, Prisma schema/migrations, React pages/context/API client và tests; không chỉ dựa vào README.
- Không đọc hoặc ghi giá trị secret vào báo cáo. File `.env` không được in ra.
- Đã chạy:
  - `back-end`: `npm test` → **25/25 tests pass**, 3/3 test files pass.
  - `back-end`: `prisma validate` → schema hợp lệ về mặt cú pháp.
  - `front-end-web`: `npm run lint` → exit 0, còn khoảng 20 warnings.
  - `front-end-web`: `npm run build` → build thành công; JS bundle chính khoảng **810 KB** trước gzip.
  - `npm audit --omit=dev --audit-level=high`: backend có **8 advisories** (6 high, 2 moderate); frontend không có advisory tại thời điểm audit.
- Không chạy integration test với MySQL thật, không gọi Gemini thật và không kiểm thử trình duyệt E2E. Các lỗi Prisma query quan trọng đã được xác minh bằng Prisma Client validation mà không cần đọc dữ liệu DB.
- Worktree đang có nhiều file modified/untracked từ trước. Audit chỉ thêm file báo cáo này, không refactor mã nguồn.

## 2. Quy ước mức độ

- **P0 — Critical:** chặn luồng cốt lõi hoặc chặn triển khai mới trên môi trường sạch.
- **P1 — High:** lỗi bảo mật, rò rỉ dữ liệu, sai nghiệp vụ quan trọng, lỗi runtime của một chức năng chính hoặc nguy cơ mất dữ liệu/tài nguyên đáng kể.
- **P2 — Medium/Low:** lỗi chức năng cục bộ, cấu hình, khả năng vận hành, hiệu năng, test và tài liệu.

## 3. Tóm tắt điều hành

| Mức | Số phát hiện | Nhận định |
|---|---:|---|
| P0 | 2 | Core job detail/apply/matching lỗi Prisma; migration không thể dựng DB mới |
| P1 | 17 | Có lỗi rò rỉ internal notes, refresh-token invalidation, cache AI stale, workflow moderation, runtime UI và dependency advisories |
| P2 | 16 | Contract/UI state, validation, worker, dev/prod config, test và docs |

Không phát hiện route cho phép người dùng tự nâng role hoặc recruiter truy cập job/application của công ty khác qua các luồng chính. Các ownership check cho candidate resources, recruiter jobs, notifications và conversations nhìn chung đúng. Tuy nhiên, hệ thống **chưa sẵn sàng production** cho đến khi xử lý ít nhất toàn bộ P0 và các P1 liên quan auth/data exposure.

## 4. P0 — Critical

### P0-01 — Sai cú pháp Prisma làm hỏng job detail, apply, screening và matching

- **File/vị trí:**
  - `back-end/src/routes/jobs.routes.js:167, 190, 244, 256`
  - `back-end/src/routes/applications.routes.js:70`
  - `back-end/src/routes/candidates.routes.js:381`
- **Bằng chứng:** các query đặt `OR` bên trong scalar filter: `deadline: { OR: [{ gte: ... }, { equals: null }] }`. `DateTimeNullableFilter` không hỗ trợ `OR`. Prisma Client trả: `Unknown argument OR`.
- **Ảnh hưởng:** các endpoint `GET /api/jobs/:id`, screening questions, match V1/V2, apply và phân tích CV–job trả 500 trước khi query DB. Đây là toàn bộ luồng xem chi tiết → chấm điểm → ứng tuyển.
- **Tái hiện:** gọi `GET /api/jobs/<published-id>` hoặc gọi trực tiếp Prisma với cùng `where`; Prisma validation từ chối query.
- **Đề xuất:** chuyển điều kiện thành top-level `OR`, ví dụ `where: { id, status: 'PUBLISHED', OR: [{ deadline: { gte: now } }, { deadline: null }] }`. Thêm integration tests cho tất cả endpoint trên bằng Prisma test DB.

### P0-02 — Không có baseline migration để dựng database mới

- **File/vị trí:**
  - `back-end/prisma/migrations/20261026120000_add_employment_type_enum/migration.sql:1`
  - `back-end/database/init.sql:1-8`
  - `back-end/database/README.md:1-8`
- **Bằng chứng:** migration đầu tiên chạy `UPDATE jobs`/`ALTER TABLE jobs`; không có migration tạo các bảng nền `users`, `jobs`, `candidates`, `applications`... `init.sql` chỉ tạo database rỗng, trong khi README yêu cầu chạy migration ngay sau đó.
- **Ảnh hưởng:** `prisma migrate deploy/dev` trên database sạch thất bại ở migration đầu tiên. Dùng `db push` trước migration tạo drift và không phải quy trình production an toàn.
- **Tái hiện:** tạo MySQL database rỗng bằng `init.sql`, sau đó chạy migration theo README.
- **Đề xuất:** tạo và kiểm chứng baseline migration đầy đủ, hoặc baseline migration history chính thức cho DB hiện hữu. Thêm CI dựng database hoàn toàn mới bằng `prisma migrate deploy`.

## 5. P1 — High

### P1-01 — Company detail dùng nested include không tồn tại

- **File/vị trí:** `back-end/src/routes/companies.routes.js:90-111`, đặc biệt `103-104`.
- **Bằng chứng:** `reviews` và `_count.followers` được đặt bên trong relation `jobs`. Model `Job` không có `reviews` hoặc `followers`; hai relation này thuộc `Company`. Prisma trả `Unknown argument reviews`.
- **Ảnh hưởng:** `GET /api/companies/:id` luôn trả 500; trang công ty, reviews và danh sách việc của công ty không hoạt động.
- **Tái hiện:** gọi `GET /api/companies/<valid-id>`.
- **Đề xuất:** đưa `reviews` và company `_count` thành sibling của `jobs` trong `Company.include`. Thêm route integration test.

### P1-02 — Candidate job page tham chiếu hàm ngoài scope

- **File/vị trí:** `front-end-web/src/pages/JobBoardPage.jsx:74-115`.
- **Bằng chứng:** `analyzeResume` được khai báo bên trong `addSkill` ở dòng 89-99 nhưng được tham chiếu tại JSX của `MatchPanel` dòng 115. Lint cũng báo hàm này “declared but never used”.
- **Ảnh hưởng:** sau khi candidate load được match panel, render đánh giá identifier không tồn tại và có thể làm route rơi vào React error boundary/blank UI. Production build không kiểm tra `no-undef` nên vẫn pass.
- **Tái hiện:** đăng nhập candidate, mở một job hợp lệ và chờ match response thành công.
- **Đề xuất:** chuyển `analyzeResume` ra cùng scope với `addSkill`; bật rule `no-undef`/TypeScript và thêm component test cho `MatchPanel`.

### P1-03 — Prisma schema và migration lệch nhau ở `ResumeJobAnalysis`

- **File/vị trí:**
  - `back-end/prisma/schema.prisma:397-414`
  - `back-end/prisma/migrations/20261102194500_add_resume_job_analyses/migration.sql`
- **Bằng chứng:** schema có `candidateId` và relation `candidate` ở dòng 409-410; migration không tạo cột hoặc foreign key tương ứng. `prisma validate` chỉ kiểm tra schema, không phát hiện drift với migration.
- **Ảnh hưởng:** DB dựng từ migrations không khớp generated client; query `resumeJobAnalysis.findUnique/create` có thể lỗi unknown column, làm hỏng phân tích CV–job.
- **Tái hiện:** dựng DB từ migration rồi gọi `POST /api/candidates/me/job-analysis/:jobId`.
- **Đề xuất:** xác định relation này có thật sự cần hay không; sau đó tạo migration bổ sung đúng mapping/index/FK hoặc loại nó khỏi schema. Kiểm tra bằng `prisma migrate diff` trong CI.

### P1-04 — Candidate đọc được ghi chú nội bộ của recruiter

- **File/vị trí:**
  - `back-end/src/routes/applications.routes.js:229-242`
  - Nhãn UI “Ghi chú nội bộ”: `front-end-web/src/pages/RecruiterDashboardPage.jsx:34-38`
- **Bằng chứng:** `GET /api/applications/:id` cho cả candidate owner và recruiter, nhưng query luôn include `notes` cùng author trước khi authorization và trả nguyên object cho cả hai vai trò.
- **Ảnh hưởng:** candidate có thể xem nhận xét nội bộ, đánh giá hoặc thông tin nhạy cảm của nhà tuyển dụng về chính hồ sơ của họ.
- **Tái hiện:** candidate gọi endpoint với application ID của mình và quan sát trường `notes`.
- **Đề xuất:** dùng select/DTO theo role; chỉ recruiter cùng company (và admin nếu được chủ đích cho phép) nhận `notes`. Thêm negative authorization test kiểm tra field-level response.

### P1-05 — Đổi/reset mật khẩu không vô hiệu refresh token hiện hữu

- **File/vị trí:** `back-end/src/routes/auth.routes.js:182-193, 217-228, 254-263`.
- **Bằng chứng:** password change/reset chỉ tăng `tokenVersion`. Refresh endpoint không gắn/kiểm tra token version của refresh session; nó load user hiện tại rồi ký access token mới với version mới. Các `refresh_tokens` cũ không bị revoke.
- **Ảnh hưởng:** refresh token bị đánh cắp trước khi đổi/reset mật khẩu vẫn có thể lấy access token mới sau đó, vô hiệu mục tiêu “đăng xuất các phiên cũ”.
- **Tái hiện:** đăng nhập lấy cookie refresh A; đổi/reset password; dùng cookie A gọi `/api/auth/refresh`.
- **Đề xuất:** trong cùng transaction đổi/reset mật khẩu, revoke toàn bộ refresh token của user. Có thể lưu session/token version trong refresh record và kiểm tra khi rotate.

### P1-06 — Password reset token bị ghi log khi production thiếu SMTP

- **File/vị trí:** `back-end/src/routes/auth.routes.js:113-117`; mô tả cấu hình tại `back-end/.env.example:12-19`.
- **Bằng chứng:** khi SMTP thiếu, `sendResetLink` luôn `console.info` URL có raw reset token; không kiểm tra `NODE_ENV`. API chỉ ẩn token response ở production nhưng log vẫn chứa token.
- **Ảnh hưởng:** người có quyền đọc centralized logs có thể chiếm tài khoản. SMTP được mô tả là optional nên đây là cấu hình production có thể xảy ra.
- **Tái hiện:** chạy với `NODE_ENV=production`, không cấu hình SMTP, gọi password-reset request cho user tồn tại và kiểm tra log (không ghi token thực vào báo cáo).
- **Đề xuất:** production phải fail closed hoặc không log URL/token; chỉ cho phép dev logging khi `nodeEnv === 'development'`. Mask PII trong email logs.

### P1-07 — Recruiter sửa trực tiếp job đã publish, bỏ qua kiểm duyệt; job rejected không gửi duyệt lại được

- **File/vị trí:**
  - `back-end/src/routes/jobs.routes.js:295-325`
  - `front-end-web/src/pages/RecruiterDashboardPage.jsx:159-182, 199`
- **Bằng chứng:** PATCH cho phép update title/description/skills của mọi status và không đưa job trở lại `DRAFT/PENDING`. Trường `status` bị destructure rồi bỏ. UI cho sửa mọi job. Với job `REJECTED`, UI gửi `status: DRAFT` nhưng backend bỏ qua, sau đó `/submit` từ chối vì status vẫn `REJECTED`.
- **Ảnh hưởng:** nội dung đã được admin duyệt có thể bị thay hoàn toàn mà vẫn `PUBLISHED`; workflow resubmit bị khóa với rejected jobs.
- **Tái hiện:** recruiter PATCH một job `PUBLISHED`; quan sát nội dung đổi nhưng status vẫn publish. Thử submit lại job `REJECTED` từ UI.
- **Đề xuất:** định nghĩa state machine rõ ràng. Thay đổi trường nhạy cảm của published/rejected job phải chuyển về draft/pending và cần duyệt lại; enforce ở backend, không chỉ UI.

### P1-08 — Xóa CV sau khi apply làm recruiter mất CV dù có trường snapshot

- **File/vị trí:**
  - `back-end/src/routes/candidates.routes.js:291-318, 646-651`
  - `back-end/prisma/schema.prisma:252-265`
  - `back-end/src/routes/applications.routes.js:88-103`
- **Bằng chứng:** application lưu `resumePathSnapshot`, nhưng download endpoint chỉ nhận `CandidateResume.id` và xác quyền qua `application.resumeId`. Khi candidate xóa CV, DB `onDelete: SetNull` rồi file vật lý bị xóa; snapshot không được sử dụng.
- **Ảnh hưởng:** recruiter không còn tải được tài liệu đã nộp; hồ sơ ứng tuyển mất tính bất biến/auditability.
- **Tái hiện:** candidate apply bằng CV, xóa CV, recruiter mở application và tải CV.
- **Đề xuất:** tạo immutable application attachment/snapshot vật lý riêng hoặc cấm xóa file còn được application tham chiếu. Download theo application ownership, không phụ thuộc resume hiện tại.

### P1-09 — Công thức salary matching đánh giá ngược khả năng đáp ứng lương

- **File/vị trí:** `back-end/src/services/matching.service.js:95-102`; tài liệu `docs/ai-matching.md` mục 3.2.
- **Bằng chứng:** nếu `desired < job.min`, code giảm điểm; nếu `desired > job.max`, code trả 100. Với ý nghĩa thông thường “mức lương mong muốn”, job trả cao hơn kỳ vọng là tương thích, còn trần lương thấp hơn kỳ vọng mới là không tương thích.
- **Ảnh hưởng:** ranking V1/V2 và recruiter sorting ưu tiên sai ứng viên/job; lỗi lan sang application match score, recommendations và AI analysis.
- **Tái hiện:** candidate mong 5 triệu/job 10–20 triệu nhận điểm thấp; candidate mong 30 triệu/job 10–20 triệu nhận 100.
- **Đề xuất:** product owner xác nhận semantics và currency/unit; viết test bảng biên dưới min/trong range/trên max trước khi đổi công thức. Đồng bộ docs sau quyết định.

### P1-10 — Cache AI/matching không được invalidation như tài liệu cam kết

- **File/vị trí:**
  - `back-end/src/routes/candidates.routes.js:388-405, 423-449`
  - `back-end/src/routes/jobs.routes.js:199-224, 295-315`
  - `docs/ai-matching.md` mục 4.1–4.2
- **Bằng chứng:** `ResumeJobAnalysis` cache chỉ theo `(resumeId, jobId)` và được trả vô điều kiện, dù job description/skills hoặc candidate match profile đã đổi. V1 numeric score được tính lại nhưng reuse `existing.explanation`, nên explanation có thể stale. Không có TTL, source version, stale flag, queue hay invalidation khi candidate/job/skills thay đổi như docs mô tả.
- **Ảnh hưởng:** người dùng nhận phân tích/giải thích cũ nhưng được trình bày như kết quả hiện tại.
- **Tái hiện:** phân tích CV cho job; recruiter đổi description/skills; gọi lại analysis và nhận record cũ. Hoặc đổi candidate skills rồi gọi V1 match và quan sát explanation cũ.
- **Đề xuất:** thêm source fingerprint/version hoặc so sánh `updatedAt` với `computedAt`; invalidate/delete cache trong transaction update, hoặc dùng TTL/stale-while-revalidate thật sự. Không mô tả queue nếu chưa triển khai.

### P1-11 — Recommendations có chi phí không giới hạn theo số job/candidate

- **File/vị trí:** `back-end/src/routes/recommendations.routes.js:45-82`.
- **Bằng chứng:** candidate endpoint load toàn bộ published jobs, rồi tuần tự gọi `saveScore` cho từng job; mỗi item có thể gọi Gemini explanation và thực hiện 2 upserts. `limit` chỉ `slice` sau khi đã tính tất cả. Recruiter endpoint cũng load toàn bộ candidates rồi xử lý tuần tự trước khi slice.
- **Ảnh hưởng:** một request authenticated có thể gây N+1 DB writes, latency lớn và tiêu thụ quota Gemini; dễ trở thành application-level DoS khi dữ liệu tăng.
- **Tái hiện:** tạo nhiều jobs/candidates rồi gọi recommendations với `limit=1`; quan sát vẫn xử lý toàn bộ.
- **Đề xuất:** prefilter/paginate ở DB, chấm deterministic theo batch, chỉ gọi LLM cho top K, cache explanation đúng version và thêm route rate limit.

### P1-12 — Upload không có quota số lượng/tổng dung lượng và dùng local disk đồng bộ

- **File/vị trí:** `back-end/src/routes/candidates.routes.js:130-185, 596-651`; `back-end/src/routes/companies.routes.js:32-48, 121-135`.
- **Bằng chứng:** mỗi file có size limit nhưng không giới hạn số CV/logo hoặc tổng dung lượng theo user. `fs.mkdirSync/readFileSync/unlinkSync` chạy trên event loop. Logo cũ không được xóa.
- **Ảnh hưởng:** user authenticated có thể làm đầy disk; nhiều upload/parse 5 MB có thể block server. Local disk cũng không đồng bộ giữa replicas và không bền trên container ephemeral.
- **Tái hiện:** lặp upload CV hợp lệ 5 MB; DB/files tăng không giới hạn.
- **Đề xuất:** quota theo user, rate limit, streaming/object storage, virus/content scanning, background extraction và lifecycle cleanup. Dùng storage abstraction thay vì local path trực tiếp.

### P1-13 — Application status không có state machine

- **File/vị trí:** `back-end/src/routes/applications.routes.js:24-31, 195-210, 245-290`.
- **Bằng chứng:** recruiter có thể chuyển bất kỳ application hiện hữu sang bất kỳ status trong enum được phép, kể cả từ `WITHDRAWN/REJECTED/ACCEPTED` quay về trạng thái khác; bulk reject cũng reject cả withdrawn/accepted. Không kiểm tra transition hoặc optimistic concurrency.
- **Ảnh hưởng:** timeline và funnel mất tính đúng đắn; race giữa candidate withdraw và recruiter update có thể ghi trạng thái trái nghiệp vụ.
- **Tái hiện:** withdraw application, sau đó recruiter PATCH status thành `ACCEPTED`.
- **Đề xuất:** bảng transition hợp lệ ở backend, conditional update theo current status và transaction/row version; trả 409 khi stale transition.

### P1-14 — Frontend refresh rotation có race làm logout ngẫu nhiên

- **File/vị trí:** `front-end-web/src/services/api.js:14-35`; dashboard gọi song song tại `api.js:139-146` và nhiều pages dùng `Promise.all`.
- **Bằng chứng:** mỗi response 401 tự gọi `/auth/refresh`; không có single-flight/mutex. Backend rotate refresh token một lần. Nhiều request hết hạn cùng lúc có thể dùng cùng cookie cũ: request đầu rotate thành công, request sau thất bại và gọi `unauthorizedHandler`, xóa session.
- **Ảnh hưởng:** người dùng bị logout ngẫu nhiên khi access token hết hạn, đặc biệt ở dashboard load song song.
- **Tái hiện:** để access token hết hạn rồi kích hoạt page có nhiều API requests đồng thời.
- **Đề xuất:** một shared refresh promise; queue/retry các request sau khi refresh duy nhất hoàn tất. Backend rotate bằng transaction/conditional update và xử lý reuse rõ ràng.

### P1-15 — Admin audit screen gọi hàm ngoài scope

- **File/vị trí:** `front-end-web/src/pages/AdminDashboardPage.jsx:31-54`.
- **Bằng chứng:** `loadAuditLogs` được khai báo bên trong `loadDashboard`, nhưng `useEffect` ở dòng 53 gọi nó từ component scope. Lint báo hàm nội bộ không được dùng.
- **Ảnh hưởng:** chọn mục Audit log gây `ReferenceError`, màn hình admin lỗi.
- **Tái hiện:** đăng nhập admin và bấm “Audit log”.
- **Đề xuất:** đưa `loadAuditLogs` ra component scope/useCallback; thêm UI test cho từng admin section.

### P1-16 — Ghi screening questions không atomic

- **File/vị trí:** `back-end/src/routes/jobs.routes.js:274-315`.
- **Bằng chứng:** create job xong mới `createMany` questions ngoài transaction. Update job xong mới xóa toàn bộ questions rồi tạo lại, cũng ngoài transaction.
- **Ảnh hưởng:** lỗi ở question tạo job không đầy đủ; lỗi sau delete làm mất toàn bộ câu hỏi cũ.
- **Tái hiện:** gửi question gây DB failure sau khi job update/create thành công.
- **Đề xuất:** gói job, skills và questions trong một interactive transaction; validate cross-field trước khi ghi.

### P1-17 — Backend production dependencies có advisories chưa xử lý

- **File/vị trí:** `back-end/package.json`, `back-end/package-lock.json`.
- **Bằng chứng:** audit ngày 2026-11-03 báo 8 vulnerabilities: high ở `body-parser`, `deepmerge-ts`/Prisma toolchain, `nodemailer`, `zod`; moderate ở `mammoth`, `qs`. `mammoth` trực tiếp xử lý DOCX do user upload.
- **Ảnh hưởng:** DoS, directory traversal hoặc các vấn đề mail parsing/SMTP tùy đường code và cấu hình. Không phải mọi advisory đều chắc chắn exploitable trong app, nhưng production dependency tree hiện không đạt audit high.
- **Tái hiện:** `cd back-end && npm audit --omit=dev --audit-level=high`.
- **Đề xuất:** nâng patch/minor không breaking trước; đánh giá migration cho Zod/Nodemailer breaking versions; thêm dependency audit vào CI. Không chạy `audit fix --force` mù quáng.

## 6. P2 — Medium/Low

### P2-01 — Logo upload trả URL không được server phục vụ

- **File/vị trí:** `back-end/src/routes/companies.routes.js:32, 121-133`; `back-end/src/app.js:26`.
- **Bằng chứng:** uploader ghi vào `back-end/uploads`, nhưng `/assets` serve `back-end/public`; API trả `/assets/<uploaded-name>`.
- **Tái hiện:** upload logo rồi GET URL trả về.
- **Đề xuất:** dùng cùng storage/public route hoặc signed asset endpoint; thêm signature validation JPG/PNG và cleanup logo cũ.

### P2-02 — Direct `zod.parse` biến lỗi client thành 500

- **File/vị trí:** `back-end/src/routes/recommendations.routes.js:46, 61-62, 86`; `back-end/src/routes/recruiters.routes.js:58`; `back-end/src/routes/companies.routes.js:77`; `back-end/src/middleware/errorHandler.js:3-19`.
- **Bằng chứng:** `ZodError` ném trong handler không được map thành 400; error handler mặc định 500 và trả raw message.
- **Tái hiện:** gửi `limit=abc`, invalid recruiter filters hoặc invalid review body.
- **Đề xuất:** dùng middleware `validate` nhất quán hoặc map `ZodError` thành 400 với response chuẩn.

### P2-03 — API contract frontend/backend lệch ở trạng thái ứng tuyển và email

- **File/vị trí:**
  - `front-end-web/src/pages/JobBoardPage.jsx:217-220` so với `back-end/src/routes/candidates.routes.js:255-262, 417-420`
  - `front-end-web/src/pages/RecruiterDashboardPage.jsx:199` so với `back-end/src/routes/applications.routes.js:185, 232`
- **Bằng chứng:** job board đọc `profile.applications`, nhưng candidate profile API không include applications, nên `appliedIds` luôn rỗng. Recruiter UI đọc `candidate.user.email`, nhưng managed/detail API chỉ select `id/fullName/phone`.
- **Tái hiện:** candidate đã apply vẫn không thấy trạng thái applied ở board; recruiter application table hiển thị email `undefined`.
- **Đề xuất:** định nghĩa response DTO/OpenAPI; dùng `/applications/me` cho applied IDs hoặc thêm field có chủ đích; thống nhất email select theo privacy policy.

### P2-04 — Password reset backend không có frontend flow

- **File/vị trí:** `front-end-web/src/pages/AuthPage.jsx:69`; `front-end-web/src/routes/AppRoutes.jsx:40-58`; `front-end-web/src/services/api.js:38-44`; backend `auth.routes.js:195-228`.
- **Bằng chứng:** nút “Quên mật khẩu?” không có handler; không có API wrapper hoặc `/reset-password` route, dù email backend trỏ tới route đó.
- **Tái hiện:** bấm quên mật khẩu hoặc mở link reset.
- **Đề xuất:** bổ sung request/confirm pages và API contract; test deep link production SPA.

### P2-05 — Dev config mặc định không route `/api` và `/assets` sang backend

- **File/vị trí:** `front-end-web/src/services/api.js:1`; `front-end-web/vite.config.js:1-7`; `front-end-web/.env.example`; `front-end-web/src/pages/AuthPage.jsx:5-6`.
- **Bằng chứng:** `VITE_API_URL`/`VITE_ASSET_URL` để trống; client fallback `/api`; Vite không có proxy. Chạy Vite 5173 và backend 5000 theo README làm request/assets đi nhầm server frontend.
- **Tái hiện:** chạy hai dev server với env example nguyên trạng rồi login/load ảnh.
- **Đề xuất:** cấu hình Vite proxy cho `/api` và `/assets`, hoặc điền URL rõ trong env example; tài liệu một phương án chuẩn.

### P2-06 — Expired/closed jobs vẫn xuất hiện ở recommendations/saved/invitations/chat

- **File/vị trí:** `back-end/src/routes/recommendations.routes.js:48, 91-92`; `back-end/src/routes/candidates.routes.js:234-236, 669-678`; `back-end/src/routes/recruiters.routes.js:90-99`.
- **Bằng chứng:** các query chỉ kiểm tra `status=PUBLISHED` hoặc thậm chí invitation không kiểm tra status/deadline.
- **Tái hiện:** tạo job published đã quá deadline hoặc job draft, rồi gọi các endpoint tương ứng.
- **Đề xuất:** dùng một reusable “active published job” predicate; invitation chỉ cho job ở trạng thái sản phẩm cho phép.

### P2-07 — Unread count theo conversation luôn tối đa 1

- **File/vị trí:** `back-end/src/routes/conversations.routes.js:66-85`.
- **Bằng chứng:** query chỉ include `messages take: 1`, sau đó dùng mảng một phần tử để đếm unread.
- **Tái hiện:** có nhiều unread messages trong một conversation rồi gọi list conversations.
- **Đề xuất:** relation `_count` với filter hoặc groupBy/count query; phân trang message history.

### P2-08 — Admin group-by filter không được gửi và audit/reviews thiếu loading state tốt

- **File/vị trí:** `front-end-web/src/pages/AdminDashboardPage.jsx:25, 31-54`; `front-end-web/src/services/api.js:139-146`.
- **Bằng chứng:** thay `filters.groupBy` trigger reload nhưng `loadDashboard()` gọi `adminApi.dashboard()` không truyền `filters`.
- **Tái hiện:** đổi day/month/year, network request không đổi query.
- **Đề xuất:** truyền filters, cancel/ignore stale requests và tách loading/error theo section.

### P2-09 — Refresh expiry config bị bỏ qua và rotate backend không atomic

- **File/vị trí:** `back-end/src/config/env.js:14-16`; `back-end/src/routes/auth.routes.js:91-107, 182-193`.
- **Bằng chứng:** `REFRESH_TOKEN_EXPIRES_IN` được đọc nhưng cookie/DB expiry hard-code 7 ngày. Revoke token cũ và create token mới không cùng transaction/conditional update.
- **Tái hiện:** đổi env expiry và quan sát `Max-Age`/DB vẫn 7 ngày; gửi hai refresh song song.
- **Đề xuất:** parse duration config một nguồn; rotate trong transaction với `updateMany where revokedAt:null` và kiểm tra count/reuse.

### P2-10 — Rate limiting chưa production-safe

- **File/vị trí:** `back-end/src/services/llm.service.js:4-50`; `back-end/src/app.js:20-26`; `back-end/src/routes/conversations.routes.js:19-26`.
- **Bằng chứng:** AI quota nằm trong process memory, reset khi restart và bypass qua nhiều replicas. Không có global/API/upload/recommendation limit. App không cấu hình `trust proxy`, ảnh hưởng IP limiter/view keys sau reverse proxy.
- **Tái hiện:** restart hoặc đổi instance để reset AI quota; deploy sau proxy và quan sát IP behavior.
- **Đề xuất:** Redis/shared rate limit, quota theo user/IP/route, proxy config có allowlist và giới hạn body/upload/recommendations.

### P2-11 — Gemini embedding không có timeout/rate limit; cache không có lifecycle

- **File/vị trí:** `back-end/src/services/matching.service.js:164-183`; so với timeout generateContent tại `llm.service.js:52-67`.
- **Bằng chứng:** `embedContent` fetch không dùng `AbortController`; endpoint V2 không qua `canUse`; `EmbeddingCache` không có TTL/cleanup. User có thể thay profile để tạo nhiều content hashes.
- **Tái hiện:** upstream embedding treo hoặc liên tục đổi profile rồi gọi match V2.
- **Đề xuất:** timeout/retry bounded, shared quota, max cache size/retention và metrics.

### P2-12 — Job alert worker có thể gửi trùng trong multi-instance/failure window

- **File/vị trí:** `back-end/src/server.js:1-8`; `back-end/src/jobs/alertWorker.js:12-49`.
- **Bằng chứng:** mỗi API instance tự start cron; không có distributed lock/claim. Notification/email được tạo/gửi trước khi cập nhật `lastSentAt`; lỗi mail hoặc hai workers gây retry/trùng.
- **Tái hiện:** chạy hai server cùng DB hoặc làm SMTP fail sau notification create.
- **Đề xuất:** worker riêng + distributed lease/idempotency key; cập nhật state/outbox transaction và retry có kiểm soát.

### P2-13 — Chat widget hiển thị cho guest/admin dù backend flow không hỗ trợ đúng

- **File/vị trí:** `front-end-web/src/App.jsx:7-9`; `front-end-web/src/components/ChatWidget.jsx:4-18`; `back-end/src/routes/recommendations.routes.js:85-100`.
- **Bằng chứng:** widget luôn render; route yêu cầu auth. Admin rơi vào nhánh tools của recruiter nhưng `recruiter` là null, có thể lỗi khi tool chạy.
- **Tái hiện:** dùng widget khi chưa login hoặc bằng admin.
- **Đề xuất:** chỉ render cho role được hỗ trợ; backend reject role khác rõ ràng bằng 403.

### P2-14 — Test suite pass nhưng không bao phủ lỗi production quan trọng

- **File/vị trí:** `back-end/tests/routes.test.js`, `matching.service.test.js`, `jobAlert.service.test.js`; frontend không có test script.
- **Bằng chứng:** 25 tests chủ yếu kiểm tra schema/helper/rate limiter; không mock/execute Prisma queries, auth refresh lifecycle, ownership response fields, migrations, React rendering hoặc API contract. Vì vậy P0-01, P1-01, P1-02 và P1-15 vẫn tồn tại dù test pass.
- **Đề xuất:** test pyramid gồm unit + Prisma integration DB + Supertest auth/ownership + React Testing Library + Playwright smoke; CI chạy fresh migration, lint, build, tests và audit policy.

### P2-15 — React hooks/UI states còn nhiều warning và race/stale response

- **File/vị trí:** lint warnings tại `AuthContext.jsx`, `MessagesPage.jsx`, `RecruiterTalentPage.jsx`, `AdminDashboardPage.jsx`, `CandidateProfilePage.jsx`, `JobBoardPage.jsx`, `RecruiterDashboardPage.jsx`.
- **Bằng chứng:** missing hook dependencies, set state trực tiếp trong effects, unused functions/params; fetch effects không abort hoặc guard response order. Messages polling có thể ghi response cũ sau khi đổi conversation.
- **Đề xuất:** sửa dependencies bằng `useCallback` hoặc tách effect; dùng `AbortController`/request ID; thêm submit/loading disable để chống double submit. Bật lint `no-undef` thành error.

### P2-16 — Tài liệu và production setup lỗi thời/không đầy đủ

- **File/vị trí:** `front-end-web/README.md`; `back-end/README.md`; `docs/ai-matching.md`; hai `package.json` và env examples.
- **Bằng chứng:** frontend README vẫn là template Vite. Backend README thiếu nhiều endpoint mới. AI doc mô tả TTL, queue, stale invalidation và nhiều match-score endpoints chưa tồn tại. Env example thiếu `GEMINI_EMBEDDING_MODEL` và `MATCHING_V2_WEIGHTS`. Backend không có `prisma migrate deploy` script/Node `engines`; frontend không nêu SPA fallback/reverse proxy. Build cảnh báo bundle 810 KB.
- **Đề xuất:** tách rõ “đã triển khai” và “thiết kế tương lai”; cập nhật endpoint/config/runbook; thêm production deploy script, health/readiness, graceful migration policy, SPA fallback và code splitting.

## 7. Đối chiếu API frontend/backend

| Nhóm | Kết quả |
|---|---|
| Auth login/register/refresh/logout/me | Path/method khớp; còn race refresh và thiếu frontend password-reset |
| Jobs list/detail/match/apply/questions | Path khớp; nhiều backend query runtime-fail do deadline filter; match panel frontend có lỗi scope |
| Candidate profile/resources/resumes/saved/alerts | Phần lớn khớp; `profile.applications` là contract không tồn tại; applied CV snapshot bị mất khi xóa |
| Recruiter jobs/applications/talent/funnel | Path khớp; email frontend mong đợi không có; state machine/moderation sai |
| Company/follow/review/logo | Path khớp; company query và logo asset contract lỗi |
| Admin | Path khớp; audit UI lỗi scope, groupBy không truyền |
| Conversations | Path khớp; unread per-thread sai, polling không phân trang |
| AI/recommendations | Path khớp; stale cache, expired jobs và work không giới hạn |

## 8. Các kiểm soát đang làm tốt

- `.env` và `uploads/` đã được gitignore; không thấy hard-coded production secret trong file được audit.
- Access token lưu trong memory frontend, không lưu localStorage; refresh/reset token được hash trong DB.
- Refresh cookie có `HttpOnly`, `SameSite=Lax`, scoped path và `Secure` ở production.
- Auth middleware kiểm tra user status và token version trên mỗi access-token request.
- Recruiter job/application/conversation ownership chủ yếu ràng buộc theo `companyId`; candidate resources và notifications ràng buộc theo current user.
- CV có random server filename, size limit, extension/MIME check, signature check cơ bản và cleanup file nếu DB create lỗi.
- CORS dùng allowlist cấu hình và `credentials: true`; Helmet được bật.
- Password hashing dùng bcrypt cost 12; reset token và unsubscribe token dùng crypto primitives phù hợp.

## 9. Thứ tự xử lý đề xuất

1. **Release blocker:** P0-01, P0-02, P1-01, P1-02, P1-03.
2. **Security/data:** P1-04, P1-05, P1-06, P1-08, P1-12, P1-17.
3. **Business correctness:** P1-07, P1-09, P1-10, P1-13, P1-16.
4. **Stability/scale:** P1-11, P1-14, P1-15 và P2 worker/rate-limit/cache.
5. **Quality gate:** bổ sung integration/E2E tests rồi cập nhật API docs, README và production runbook.

Không nên refactor diện rộng trước khi khóa behavior bằng test cho auth lifecycle, job state machine, application state machine và matching salary/cache semantics.
