# Job Connect Mobile & Desktop E2E Report

> **Cập nhật 2026-11-04 sau sửa lỗi:** Ba lỗi P1 `JC-E2E-001`, `JC-E2E-003` và `JC-E2E-004` đã được sửa và regression PASS. Phần chẩn đoán bên dưới được giữ làm lịch sử phát hiện; trạng thái xác minh mới nhất nằm trong `THREE_BUG_FIX_REPORT.md`.

Ngày chạy: 2026-11-04  
Múi giờ: Asia/Saigon  
Phạm vi: 375×812, 390×844, 430×932 và 1440×900; auth/session, responsive shell, lazy routes và nghiệp vụ ba vai trò.

## 1. Kết luận

- Frontend `http://localhost:5173`, backend `http://localhost:5000` và MySQL development đều hoạt động; health backend HTTP 200.
- Database ban đầu có đúng 3 tài khoản seed ACTIVE: CANDIDATE, RECRUITER, ADMIN; 1 company, 1 PUBLISHED job, 1 CV, 0 application, 0 conversation và 0 message.
- Authentication UI, reload/session restoration và logout: **3/3 PASS** khi chạy riêng, mỗi role login đúng một lần.
- Candidate shell: **PASS 4/4 viewport**. Recruiter shell: **PASS 4/4 viewport**.
- Admin UI shell/heading: **PASS 4/4 viewport**; tiêu chí API: **FAIL 4/4** do `GET /api/conversations/unread-count` trả 403.
- Admin 430px không mất heading. Failure cũ là lỗi automation do replay refresh cookie đã rotate và lệch host `localhost`/`127.0.0.1`.
- Phát hiện thêm hai lỗi sản phẩm HTTP 500 ở public detail. Job detail 500 chặn save/apply và kéo theo pipeline/messages nghiệp vụ.
- Không sửa frontend sản phẩm, backend, RBAC, rate limiter hay business logic. Chỉ sửa/thêm Playwright automation.

## 2. Môi trường và dữ liệu test

| Thành phần | Trạng thái |
|---|---|
| Frontend Vite development | PASS, HTTP 200 |
| Backend Express development | PASS, `/api/health` HTTP 200 |
| MySQL `job_connect` | PASS |
| Test accounts | 3 ACTIVE users, đúng ba role |
| Access token | Chỉ nằm trong memory frontend |
| Refresh token | HttpOnly cookie, có rotation |
| Production data | Không truy cập/không thay đổi |

Do thiếu pending job/application, automation đã tạo qua UI hai fixture nhận diện riêng:

- `QA-E2E-20261104-FULLSTACK`
- `QA-E2E-20261104-FULLSTACK-R2`

Cả hai được Recruiter gửi duyệt và Admin duyệt trong database development. Snapshot cuối: 3 PUBLISHED jobs, 1 CV, vẫn 0 application/conversation/message. Không cleanup để giữ bằng chứng tái hiện; dữ liệu chỉ nằm ở development.

## 3. Authentication và session restoration

| Test case | Candidate | Recruiter | Admin |
|---|---|---|---|
| UI login thật | PASS | PASS | PASS |
| Chuyển route sau login | `/jobs` PASS | `/recruiter` PASS | `/admin` PASS |
| Reload protected route | PASS | PASS | PASS |
| Restore access token từ HttpOnly refresh cookie | PASS | PASS | PASS |
| Logout | PASS | PASS | PASS |

Lệnh auth cuối: **3 passed (42.5s)**. `QA_SKIP_AUTH_SETUP=1` và `QA_RUN_AUTH_SESSION=1` bảo đảm chỉ có ba login, không login lại cho từng viewport.

### Lỗi automation/môi trường đã phân biệt

1. Playwright từng mở frontend bằng `127.0.0.1` nhưng backend CORS và refresh cookie dùng `localhost`. Kết quả là `Origin không được phép` và cookie không được gửi. Đã đồng bộ default base URL về `http://localhost:5173`.
2. Backend rotate refresh token. Một storage state không thể replay đồng thời ở nhiều browser context. Matrix hiện dùng một context liên tục cho mỗi role và ghi cookie mới trở lại `.auth/<role>.json`.
3. Logout revoke toàn bộ refresh token của user và tăng `tokenVersion`. Auth-session được chuyển thành opt-in chạy cuối để không phá state của matrix.
4. Retry login bổ sung đã tái hiện HTTP 429. Đây là lỗi thiết kế/chạy test, không phải lỗi credentials hay sản phẩm. Backend development chỉ được restart để xóa bộ đếm in-memory; không disable/bypass rate limiter.

## 4. Responsive shell matrix

| Role / tiêu chí | 375 | 390 | 430 | 1440 |
|---|---|---|---|---|
| Candidate UI shell | PASS | PASS | PASS | PASS |
| Recruiter UI shell | PASS | PASS | PASS | PASS |
| Admin heading/UI shell | PASS | PASS | PASS | PASS |
| Admin API sạch lỗi | FAIL 403 | FAIL 403 | FAIL 403 | FAIL 403 |

Mỗi UI shell PASS đã kiểm tra route/heading, session restoration, không horizontal overflow, không uncaught `pageerror`; mobile còn kiểm tra drawer mở và đóng bằng Escape. Kết quả lệnh matrix: **2 passed, 1 failed có chủ đích**; Admin chỉ fail assertion API.

Admin 430px:

- Screenshot có heading `Tổng quan hệ thống`.
- DOM thực là Admin dashboard, không phải login form.
- Không horizontal overflow và không JavaScript page error.
- 403 không làm mất heading vì shared shell swallow exception.

## 5. Admin 403 — nguyên nhân đã xác minh

| Method | Endpoint | Status | Response đã sanitize |
|---|---|---:|---|
| GET | `/api/conversations/unread-count` | 403 | `{ "success": false, "message": "Bạn không có quyền thực hiện thao tác này" }` |

Chuỗi nguyên nhân:

1. `AppShell.jsx:51-53` gọi/poll `messagesApi.unreadCount()` cho mọi authenticated user, kể cả ADMIN.
2. `api.js:144` ánh xạ tới `/conversations/unread-count`.
3. `conversations.routes.js:48` chỉ cho `CANDIDATE` và `RECRUITER`.
4. `auth.js:34-38` trả 403 khi role không nằm trong allow-list.

RBAC backend hoạt động đúng. Lỗi sản phẩm nằm ở frontend shared shell gọi endpoint không áp dụng cho Admin. Không nên mở quyền endpoint cho Admin; hướng sửa đề xuất sau giai đoạn chẩn đoán là chỉ poll unread messages cho CANDIDATE/RECRUITER.

## 6. Test case nghiệp vụ

### Candidate

| Test case | Trạng thái | Ghi chú |
|---|---|---|
| Login/redirect/session restore/logout | PASS | UI thật, reload thật |
| Profile render + direct refresh | PASS | Dữ liệu `Demo Candidate` |
| CV tab/list | PASS | 1 CV seed render |
| Tìm kiếm + filter job list | PASS | Fixture QA xuất hiện đúng |
| Mở job detail | **FAIL** | `GET /api/jobs/3` HTTP 500 |
| Lưu job | BLOCKED | Phụ thuộc job detail |
| Apply bằng CV | BLOCKED | Phụ thuộc job detail và screening endpoint cùng lỗi filter |
| My Jobs/application history | BLOCKED | Không có application vì apply bị chặn |
| AI recommendations + direct refresh | PASS | Recommendation card render |
| Messages empty-state + direct refresh | PASS | 0 conversation đúng snapshot |
| Gửi/nhận message | BLOCKED | Conversation chỉ tạo từ application |

### Recruiter

| Test case | Trạng thái | Ghi chú |
|---|---|---|
| Login/redirect/session restore/logout | PASS | UI thật |
| Dashboard/charts + direct refresh | PASS | Không page error |
| Tạo job, autosave draft, gửi duyệt | PASS | Hai fixture QA được tạo qua wizard |
| Quản lý job | PASS | Fixture hiển thị trong table |
| Talent search + direct refresh | PASS | Route và kết quả render |
| Applications empty table | PASS | Phù hợp DB có 0 application |
| Pipeline nghiệp vụ/status/note | BLOCKED | Candidate apply bị job detail 500 chặn |
| Messages empty-state | PASS | Phù hợp DB |
| Gửi message ứng viên | BLOCKED | Chưa có application/conversation |

### Admin

| Test case | Trạng thái | Ghi chú |
|---|---|---|
| Login/redirect/session restore/logout | PASS | UI thật |
| Dashboard + direct refresh | PASS WITH KNOWN 403 | Core UI render; API criterion fail |
| Heading 430px | PASS | Screenshot + DOM |
| User management read | PASS | 3 seed users hiển thị |
| Audit log read | PASS | Route/heading/table render |
| Job moderation | PASS | Hai fixture QA chuyển PENDING → PUBLISHED |
| Khóa/mở khóa hoặc đổi role seed account | BLOCKED | Không mutation account seed dùng chung; không có disposable user fixture |

### Lazy-loaded route refresh

PASS: `/profile`, `/recommendations`, `/messages`, `/recruiter`, `/recruiter/talent`, `/admin`.  
FAIL: `/jobs/3` do API detail 500, không phải lỗi tải chunk.  
Route transition sau login PASS cho cả ba role.

## 7. Bug list

### P0

Không phát hiện P0.

### P1 — JC-E2E-001: Admin shell poll endpoint messages bị RBAC từ chối

Tái hiện:

1. Login ADMIN.
2. Mở `/admin` ở bất kỳ viewport nào.
3. Quan sát Network.
4. `GET /api/conversations/unread-count` trả 403 lúc mount và lặp theo polling.

Ảnh hưởng: tạo console/network noise liên tục; core Admin UI vẫn render.

### P1 — JC-E2E-003: Public job detail trả HTTP 500

Tái hiện:

1. Mở `/jobs` và chọn một PUBLISHED job, hoặc mở trực tiếp `/jobs/3`.
2. Quan sát `GET /api/jobs/3` trả 500.
3. Detail không render; UI quay về empty detail `Chọn một việc làm`.

Root cause: `jobs.routes.js:258` và `jobs.routes.js:270` dùng `deadline: { OR: [...] }`. `deadline` là scalar DateTime filter nên Prisma không chấp nhận `OR` ở cấp này và ném `PrismaClientValidationError`. Cùng pattern còn xuất hiện ở match route. Lỗi chặn job detail, save/apply, screening questions và toàn bộ pipeline downstream.

### P1 — JC-E2E-004: Public company detail trả HTTP 500

Tái hiện:

1. Click tên công ty trên job card hoặc mở `/companies/1`.
2. `GET /api/companies/1` trả 500.
3. UI hiển thị `Đã xảy ra lỗi máy chủ`.

Root cause: `companies.routes.js:126-127` đặt `reviews` và `_count.followers` bên trong `jobs.select`; Prisma Job không có các field/relation đó, dẫn đến `PrismaClientValidationError`.

### P2 — JC-E2E-002: Admin pie chart mobile khó đọc

Tại 430px pie chart nhỏ và để vùng trắng lớn. Không gây overflow hoặc mất thao tác, nhưng cần visual refinement.

## 8. Evidence đã sanitize

- Admin 430 screenshot: `front-end-web/e2e-artifacts/role-matrix/admin/mobile-430.png`
- Admin matrix JSON: `front-end-web/e2e-artifacts/role-matrix/admin/matrix-results.json`
- Admin focused DOM/network: `front-end-web/e2e-artifacts/admin-diagnostic/mobile-430/`
- Candidate/Recruiter/Admin shell screenshots: `front-end-web/e2e-artifacts/role-matrix/`
- Read-only business JSON: `front-end-web/e2e-artifacts/business-readonly/results-sanitized.json`
- Read-only screenshots: `front-end-web/e2e-artifacts/business-readonly/`
- Job detail 500 screenshot: `front-end-web/e2e-artifacts/public-detail-diagnostic/job-detail-500.png`
- Company detail 500 screenshot: `front-end-web/e2e-artifacts/public-detail-diagnostic/company-detail-500.png`
- Public detail network metadata: `front-end-web/e2e-artifacts/public-detail-diagnostic/network-sanitized.json`
- Recruiter pending job/Admin users screenshots: `front-end-web/e2e-artifacts/business-lifecycle/`

Các JSON evidence chỉ có method/path/status và kết quả assertion; không có password, Authorization header, access token, refresh cookie hay request body. `.auth/`, `test-results/`, trace và Playwright report tiếp tục bị gitignore vì có thể chứa session metadata.

## 9. Automation thay đổi

- `playwright.config.js`: đồng bộ base URL về `localhost`.
- `role-matrix-stable.spec.js`: dùng một context liên tục/role và persist cookie rotated vào đúng role state.
- `admin-diagnostic.spec.js`: persist refresh cookie sau diagnostic viewport.
- `auth-session.spec.js`: opt-in, chạy cuối, không global-login lặp.
- Thêm `business-lifecycle.spec.js`, `business-readonly.spec.js`, `public-detail-diagnostic.spec.js`.

Không có code sản phẩm nào được sửa trong đợt chẩn đoán này.
