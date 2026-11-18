# Job Connect — Three Verified Bug Fix Report

Ngày xác minh: 2026-11-04  
Môi trường: development local, MySQL `job_connect`; không truy cập production.

## 1. Root cause và thay đổi

### JC-E2E-001 — Admin gọi unread-count không hợp lệ

- Root cause: shared `AppShell` khởi tạo polling messages cho mọi user đã đăng nhập, trong khi backend endpoint giữ đúng RBAC chỉ cho CANDIDATE/RECRUITER.
- Sửa tại `front-end-web/src/components/AppShell.jsx:22-24, 49-56`:
  - Chuẩn hóa `userRole`.
  - Chỉ mount polling khi role là `CANDIDATE` hoặc `RECRUITER`.
  - Không sửa backend conversations route và không cấp quyền ADMIN.
- API contract không đổi.

### JC-E2E-003 — Job detail HTTP 500

- Root cause: Prisma DateTime scalar filter không chấp nhận `deadline: { OR: [...] }`; `OR` phải nằm ở cấp `where`.
- Sửa tại:
  - `back-end/src/routes/jobs.routes.js:181, 204, 258, 270`: public match v2, match, screening questions và detail dùng `OR: [{ deadline: { gte: now } }, { deadline: null }]` ở cấp `where`.
  - `back-end/src/routes/applications.routes.js:72-77`: apply route dùng cùng public-job predicate hợp lệ. Đây là regression trực tiếp cần thiết để mở lại case apply từng BLOCKED.
- Chỉ PUBLISHED job chưa hết hạn/không deadline được trả. DRAFT, PENDING, CLOSED và REJECTED trả 404. Prisma schema hiện không có enum `PRIVATE`; mọi trạng thái ngoài PUBLISHED đều không public.
- Response contract job detail giữ nguyên, gồm `applicantCount` và không lộ `_count`.

### JC-E2E-004 — Company detail HTTP 500

- Root cause: `reviews` và follower `_count` là relation của Company nhưng bị đặt trong `jobs` selection.
- Sửa tại `back-end/src/routes/companies.routes.js:116-130`:
  - `jobs` chỉ select field/relation thuộc Job.
  - `reviews` và `_count.followers` được chuyển thành sibling trong Company `include`.
- Contract giữ nguyên: `reviews`, `averageRating`, `followerCount`, và mỗi job có `applicantCount`.
- Không thay schema hoặc migration.

## 2. Regression test đỏ trước sửa, xanh sau sửa

### Trước sửa

Backend focused regression:

- 3 FAIL, 2 PASS.
- PUBLISHED job detail nhận 500 thay vì 200.
- Company detail không đạt query shape cho cả biến thể không review/0 follower và có review/3 followers.

Frontend focused regression:

- Admin 430px tạo 3 request `GET /api/conversations/unread-count` trong khoảng 5,5 giây.
- Assertion kỳ vọng không request bị FAIL.

Blocked lifecycle lần đầu sau job detail fix còn phát hiện apply route dùng cùng DateTime filter sai và trả 500. Occurrence này được thêm vào regression application workflow và sửa cùng root cause.

### Sau sửa

| Suite | Kết quả |
|---|---|
| Backend focused public detail/company/apply | 8 PASS |
| Toàn bộ backend Vitest | 83/83 PASS, 11 files |
| Admin no conversation polling, 430 + 1440 | 1/1 PASS |
| Public job/company detail browser test | 1/1 PASS |
| Candidate/Recruiter/Admin responsive role matrix | PASS tại 375/390/430/1440 |
| Combined focused Playwright regression | 5/5 PASS |
| Apply → pipeline → conversation → messages lifecycle | 1/1 PASS |
| Frontend lint | PASS, exit 0; 11 warning cũ |
| Frontend production build | PASS; 640 modules |

## 3. Kết quả regression chi tiết

### Access và public visibility

| Case | Kết quả |
|---|---|
| PUBLISHED job, deadline tương lai/null | PASS, HTTP 200 |
| DRAFT job public detail | PASS, HTTP 404 |
| PENDING job public detail | PASS, HTTP 404 |
| CLOSED job public detail | PASS, HTTP 404 |
| REJECTED job public detail | PASS, HTTP 404 |
| Candidate apply vào PUBLISHED job | PASS |
| Cross-role/backend RBAC suite | PASS |
| ADMIN conversations permission | Không thay đổi; vẫn bị backend từ chối nếu gọi trực tiếp |

### Company contract

| Case | Kết quả |
|---|---|
| Không reviews, 0 followers | PASS |
| Có approved review, 3 followers | PASS |
| Author mapping cho non-anonymous review | PASS |
| Job applicant count trong company detail | PASS |
| Browser `/companies/1` | PASS, HTTP 200 và DOM render |

### Cases trước đây BLOCKED

| Case | Trạng thái mới |
|---|---|
| Candidate job detail | PASS |
| Candidate save job | PASS |
| Candidate apply bằng CV seed | PASS |
| Candidate My Jobs/application | PASS |
| Recruiter application list | PASS |
| Recruiter chuyển status REVIEWING | PASS, HTTP 200 |
| Recruiter pipeline render application | PASS |
| Recruiter tạo conversation và gửi message | PASS, HTTP 201 |
| Candidate nhận và reply message | PASS, HTTP 201 |

Development snapshot cuối: 3 PUBLISHED jobs, 1 QA application ở REVIEWING, 1 conversation và 2 messages. Dữ liệu có tiền tố nhận diện `QA-E2E-20261104`; không có dữ liệu production bị tác động.

## 4. PASS / FAIL / BLOCKED còn lại

### PASS

- Cả ba lỗi mục tiêu và regression trực tiếp.
- Backend unit/integration suite.
- Frontend lint/build.
- Focused desktop/mobile Playwright.
- Session restoration và responsive shell không bị regression trong role matrix.

### FAIL

- Không còn FAIL thuộc phạm vi ba lỗi.

### BLOCKED

- Không còn BLOCKED thuộc chuỗi job detail → apply → pipeline → messages.
- Company có reviews/followers được xác minh bằng integration fixture; development DB hiện có 0 review và 0 follow nên không tạo mutation chỉ để lặp lại browser UI.

## 5. Lỗi chưa giải quyết

- 11 warning `react(set-state-in-effect)` đã tồn tại trước task; lint vẫn exit 0. Không sửa vì ngoài phạm vi.
- P2 Admin pie chart mobile khó đọc trong báo cáo QA cũ chưa xử lý vì ngoài ba lỗi được yêu cầu.
- Không phát hiện lỗi mới trong phạm vi regression này.

## 6. Evidence

- `front-end-web/e2e-artifacts/public-detail-diagnostic/network-sanitized.json`: job/company detail HTTP 200.
- `front-end-web/e2e-artifacts/public-detail-diagnostic/job-detail-fixed.png`.
- `front-end-web/e2e-artifacts/public-detail-diagnostic/company-detail-fixed.png`.
- `front-end-web/e2e-artifacts/business-lifecycle/results-sanitized.json`: pipeline/messages lifecycle; `adminForbidden` rỗng.
- `front-end-web/e2e-artifacts/role-matrix/*/matrix-results.json`: bốn viewport.

Evidence không chứa password, token, cookie, Authorization header hoặc request body nhạy cảm.
