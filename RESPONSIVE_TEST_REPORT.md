# Job Connect Responsive Test Report

Ngày kiểm tra: 2026-11-03  
Frontend: React 19 + Vite 8.3.1  
Phạm vi viewport: 320, 375, 390, 430, 768, 1024 và 1440px

## 1. Kết quả tổng quan

- `npm run lint`: **PASS**, exit code 0. Có 11 warning `react(set-state-in-effect)` đã tồn tại tại các page; không có lint error.
- `npm run build`: **PASS**, exit code 0. Vite transform thành công 638 modules.
- Build artifact cuối: CSS 72.49 kB (gzip 14.46 kB), JS 816.70 kB (gzip 238.18 kB).
- Build warning: chunk JS lớn hơn 500 kB. Đây là rủi ro performance/code-splitting, không phải lỗi responsive hoặc build failure.
- `node --check scripts/responsive-smoke.mjs`: **PASS**.
- HTTP local preview `/jobs`: **200**.
- Chrome DevTools device emulation: **PASS** cho overflow và các tương tác public được liệt kê bên dưới.

Lần chạy Vite build đầu tiên trong sandbox thất bại với `spawn EPERM`. Chạy lại cùng lệnh ngoài sandbox thành công; vì vậy lỗi đầu là giới hạn tiến trình Windows/sandbox, không phải lỗi source.

## 2. Browser smoke test tự động

Công cụ: Chrome headless + Chrome DevTools Protocol qua `scripts/responsive-smoke.mjs`. Script đặt device metrics thật, không dựa vào kích thước file screenshot.

### `/jobs`

| Width | `innerWidth` | `scrollWidth` | Horizontal overflow | Hamburger | Filter toggle |
|---:|---:|---:|---|---|---|
| 320 | 320 | 320 | Không | Hiển thị | Hiển thị |
| 375 | 375 | 375 | Không | Hiển thị | Hiển thị |
| 390 | 390 | 390 | Không | Hiển thị | Hiển thị |
| 430 | 430 | 430 | Không | Hiển thị | Hiển thị |
| 768 | 768 | 753 | Không | Ẩn | Hiển thị |
| 1024 | 1024 | 1009 | Không | Ẩn | Ẩn |
| 1440 | 1440 | 1425 | Không | Ẩn | Ẩn |

Tại 320, 375, 390 và 430px, các kiểm tra sau đều **PASS**:

- Hamburger mở drawer.
- `aria-expanded` cập nhật đúng.
- Phím Escape đóng drawer.
- Nút đóng đóng drawer.
- Filter drawer mở và đóng.
- ChatWidget mở và đóng.

Ảnh smoke test tại 768 và 1440px được xem trực quan: header, hero, filter/list/detail và chat toggle không có hiện tượng chồng hoặc overflow nhìn thấy. Backend không chạy nên danh sách job báo lỗi API và không thể xác minh job card/detail với dữ liệu thật.

### `/login`

Kiểm tra tại 390px: `innerWidth = 390`, `scrollWidth = 390`, **không có horizontal overflow**. Form login được xem trực quan; bố cục một cột và touch target hiển thị đúng.

## 3. Kiểm tra theo nhóm triển khai

### Shared Layout

- Lint/build: PASS.
- Hamburger/drawer/overlay: PASS trên public route ở 320–430px.
- Escape và nút đóng: PASS.
- ChatWidget open/close: PASS ở 320–430px.
- Modal: kiểm tra tĩnh và build PASS; chưa browser-test một modal nghiệp vụ vì cần phiên Candidate/dữ liệu.
- Rủi ro còn lại: chưa chạy focus-trap đầy đủ; implementation hiện focus dialog, restore focus, Escape và body scroll lock.

### Public

- `/jobs`: browser-test ở toàn bộ 7 viewport mục tiêu.
- `/login`: browser-test ở 390px.
- `/register`: dùng cùng AuthPage/CSS với login, đã kiểm tra tĩnh và build; chưa chụp/submit form riêng.
- `/jobs/:id`: chưa kiểm tra với job ID thật vì backend không chạy.
- `/companies/:id`: chưa kiểm tra vì không có company ID/data từ backend.
- Filter drawer open/close: PASS.
- Xóa bộ lọc: logic được giữ nguyên và lint/build PASS; chưa xác minh request API sau khi xóa do backend không chạy.

### Candidate

- Các page đã kiểm tra tĩnh/build: Recommendations, Profile, Alerts, My Jobs, Messages, CandidateApplications legacy và SavedJobs legacy.
- Messages master–detail/back: implementation và build PASS; chưa browser-test với hội thoại thật vì không có Candidate session/data.
- Profile/forms/tabs, alerts form, my-jobs cards/actions: chưa visual-test authenticated.
- Modal apply/job alert: chưa test submit vì thiếu session/backend.

### Recruiter

- Các page đã kiểm tra tĩnh/build: Dashboard, Jobs/Job Wizard, Applications, Pipeline, Company Profile và Talent Search.
- Sidebar drawer, forms, table scroll, pipeline scroll-snap và responsive chart containers: build PASS; chưa visual-test authenticated.
- Talent filters được chuyển về một cột ở mobile; chưa kiểm tra với danh sách skill/job thật.
- Drag-and-drop pipeline chưa test browser vì thiếu Recruiter session/data.

### Admin

- Các page đã kiểm tra tĩnh/build: Overview, Jobs moderation, Users, Reviews và Audit Log.
- Sidebar drawer, stat grid, responsive chart stack và controlled table scroll: build PASS; chưa visual-test authenticated.
- Moderation actions chưa test vì thiếu Admin session/backend.

## 4. Các tương tác chưa kiểm tra end-to-end

- Authentication submit/redirect với backend thật.
- Apply wizard, upload CV và modal dữ liệu thật.
- Candidate alerts create/edit/delete.
- Candidate Messages gửi/nhận và mobile back với hội thoại thật.
- Recruiter job wizard, pipeline drag/drop, talent invitation và company upload.
- Admin moderation, audit filter và chart với dataset thật.
- Notification popover với dữ liệu và unread count thật.

Các mục trên không được coi là PASS. Chúng cần backend chạy, database snapshot phù hợp và tài khoản theo từng role.

## 5. Regression risk còn lại

- Bundle JS 816.70 kB nên có thể ảnh hưởng thời gian tải trên thiết bị chậm; nên tách route bằng dynamic import trong một task performance riêng.
- Một số component page đang viết JSX trên một dòng dài và có 11 warning effect; không gây build failure nhưng tăng chi phí bảo trì.
- CSS Messages dùng `:has()` cho master–detail; Chrome hiện tại pass, cần kiểm tra thêm Safari/Firefox mục tiêu nếu đồ án yêu cầu hỗ trợ rộng.
- Admin chart đang kế thừa inline layout từ code cũ và được điều chỉnh bằng structural selector; nên visual-test lại khi có dữ liệu thật.
- Talent filter đã responsive một cột nhưng chưa có drawer collapse riêng như public job filter.

## 6. Cách chạy lại

1. Chạy frontend: `npm run dev -- --host 127.0.0.1`.
2. Chạy Chrome ở chế độ remote debugging port 9222.
3. Chạy `node scripts/responsive-smoke.mjs` trong `front-end-web`.
4. Chạy `npm run lint` và `npm run build`.

Script smoke không tạo hoặc sửa dữ liệu production; nó chỉ mở route public và thao tác UI cục bộ.
