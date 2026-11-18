# Báo cáo tối ưu hiệu năng frontend Job Connect

Ngày đo: 04/11/2026  
Frontend: React 19.2.8, React Router 7.18.4, Vite 8.3.1  
Lệnh đo: `npm run build -- --manifest`; phân tích module bằng `ANALYZE=true npm run build -- --manifest` và `rollup-plugin-visualizer` (raw-data).

## Kết luận

JavaScript tải ban đầu giảm từ **816.70 kB xuống 274.76 kB raw** và từ **238.18 kB xuống 86.95 kB gzip**. Mức giảm tương ứng là **66.36% raw** và **63.49% gzip**.

Đây là mức giảm initial JS thực, không suy ra đơn thuần từ việc tăng số chunk: manifest cuối cho thấy entry `index.html` chỉ nạp trực tiếp `assets/index-DtUCYJEk.js`; page, Recharts, DnD và chat nằm sau dynamic import. Tổng JS sinh ra là 823.31 kB raw, tăng 0.81% so với bundle đơn ban đầu do overhead của code splitting. Vì vậy tối ưu này trì hoãn JavaScript không cần cho route đầu tiên, không tuyên bố đã làm tổng mã ứng dụng nhỏ hơn.

| Chỉ số production build | Trước | Sau | Thay đổi |
| --- | ---: | ---: | ---: |
| Initial JS raw | 816.70 kB | 274.76 kB | -66.36% |
| Initial JS gzip | 238.18 kB | 86.95 kB | -63.49% |
| Tổng JS raw | 816.70 kB | 823.31 kB | +0.81% |
| JS chunks | 1 | 16 | +15 |
| Initial CSS raw | 72.49 kB | 41.88 kB | -42.23% |
| CSS chunks | 1 | 8 | +7 |

Ghi chú: tổng gzip cộng riêng từng JS chunk sau build là 251.71 kB theo số Vite hiển thị. Con số này không phải payload của lần tải đầu và cũng không hoàn toàn tương đương gzip của một bundle duy nhất vì mỗi file có overhead nén riêng.

## Phân tích bundle ban đầu

Build baseline biến đổi 638 module thành một file JS 816.70 kB. Raw-data analyzer xác định các nguồn lớn nhất:

| Nhóm/module đáng chú ý | Bằng chứng từ analyzer baseline |
| --- | ---: |
| `react-dom` client production | 517.1 kB rendered module size |
| React Router | 92.4 kB |
| `@dnd-kit/core` | 72.5 kB |
| `RecruiterDashboardPage.jsx` | 57.9 kB |
| Recharts `axisSelectors` | 45.0 kB |
| `JobBoardPage.jsx` | 41.0 kB |
| Redux Toolkit (dependency gián tiếp) | 26.0 kB |
| `AdminDashboardPage.jsx` | 24.9 kB |
| Recharts `Bar` / `Pie` | 23.9 / 22.9 kB |

Các kích thước module trên là metric rendered của visualizer, không được cộng trực tiếp để suy ra kích thước file gzip. Điểm quan trọng là Recharts, DnD và toàn bộ page của ba vai trò đều bị import tĩnh vào entry trước tối ưu.

## Thiết kế code splitting

- `AppRoutes.jsx` dùng `React.lazy` cho 11 page: Public/Auth, Candidate, Recruiter và Admin. `Suspense` dùng `LoadingScreen` hiện có.
- `RoleGuard` vẫn chạy trước page được bảo vệ, nên người dùng không đúng role không tải chunk page đó. Không thay đổi auth, RBAC, route contract hay business logic.
- Không gom cưỡng bức thành một chunk lớn theo role: cách đó làm mở một page phải tải các page khác cùng role. Route-level split vẫn tạo ranh giới tự nhiên theo Public/Candidate/Recruiter/Admin và giảm over-fetch.
- `RouteErrorBoundary` xử lý lỗi dynamic import, hiển thị thông báo tiếng Việt và nút tải lại.
- Chat AI chỉ import `ChatWidget` sau tương tác đầu tiên. Nút nổi ban đầu được giữ nguyên và fallback của chunk vẫn có trạng thái tải rõ ràng.
- Recharts và DnD không còn trong initial entry. Build cuối tạo `BarChart-BDhozfl0.js` 358.46 kB raw / 103.72 kB gzip và `PieChart-BinC5mRl.js` 17.34 kB / 5.51 kB; chúng chỉ thuộc graph của các route dashboard/talent cần chart. DnD thuộc route Recruiter Dashboard.
- Không lazy-load component nhỏ, modal hoặc control nội bộ để tránh tăng request và tạo loading boundary vụn.
- Analyzer chỉ được bật khi `ANALYZE=true`, nên không làm chậm build thường.

Các page chunk đáng chú ý sau build:

| Chunk | Raw | Gzip |
| --- | ---: | ---: |
| Recruiter Dashboard | 66.30 kB | 19.86 kB |
| Admin Dashboard | 29.21 kB | 8.58 kB |
| Job Board | 21.79 kB | 6.62 kB |
| Candidate Profile | 13.21 kB | 4.40 kB |
| Recruiter Talent | 6.00 kB | 2.28 kB |
| Auth | 5.47 kB | 2.21 kB |
| Chat AI | 1.54 kB | 0.79 kB |

## `set-state-in-effect`

`npm run lint` kết thúc với exit code 0 và còn đúng **11 warning**:

- `MessagesPage.jsx`: 1
- `RecruiterTalentPage.jsx`: 2
- `AdminDashboardPage.jsx`: 2
- `CandidateProfilePage.jsx`: 1
- `JobBoardPage.jsx`: 3
- `RecruiterDashboardPage.jsx`: 2

Không warning nào được sửa cơ học trong đợt này. Chúng nằm ở hai nhóm: effect kích hoạt đồng bộ API và cập nhật loading/error, hoặc reset dữ liệu phụ thuộc route/selection (match, funnel, job detail). Đưa các cập nhật đó ra event handler hoặc chỉ derive khi render có thể đổi thời điểm request, để lộ dữ liệu route cũ hoặc làm sai trạng thái loading. Chưa có component-level regression tests đủ để chứng minh refactor an toàn, nên giữ nguyên hành vi là lựa chọn phù hợp với ràng buộc không đổi business logic. Không thêm disable rule để che cảnh báo.

## Kiểm thử thực tế

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run lint` | PASS, exit 0; 11 warning nêu trên |
| `npm run build -- --manifest` | PASS; 640 modules; 16 JS chunks; 8 CSS chunks |
| Analyzer production build | PASS; `dist/bundle-stats.json` được tạo |
| Playwright production preview `/login` | PASS |
| Playwright production preview `/jobs` | PASS |
| Chat không tải trước, tải sau lần click đầu | PASS |

Playwright: **3/3 passed trong 5.8 giây**, Chrome headless, viewport 1440×900. Test kiểm tra root render, không có page error, các chunk dashboard/chart/chat không xuất hiện trong initial resource list của route public, và `ChatWidget` xuất hiện sau lần click đầu.

Lần smoke đầu phát hiện production preview proxy cả `/assets` sang backend, khiến JS/CSS trả 502 và root rỗng. `vite.config.js` đã tách cấu hình preview để chỉ proxy `/api`; proxy `/assets` vẫn giữ cho development server phục vụ upload backend. Sau thay đổi, build và smoke đều PASS.

Backend không chạy trong smoke production này, nên các request `/api/auth/refresh` và `/api/jobs` nhận lỗi kết nối. Smoke chỉ xác minh render/code loading, không được ghi nhận là kiểm thử nghiệp vụ hoặc API PASS. Các route đã xác thực Candidate/Recruiter/Admin chưa được chạy lại trong đợt performance vì cần backend và test accounts; báo cáo Mobile E2E hiện có vẫn là nguồn cho matrix nghiệp vụ.

Lighthouse không chạy: repository không cài Lighthouse và backend không hoạt động trong phiên đo, nên điểm số sẽ không đại diện cho hành vi end-to-end. Không tự suy diễn điểm Lighthouse từ bundle size.

## File thay đổi trong phạm vi performance

- `front-end-web/src/routes/AppRoutes.jsx`: lazy route và Suspense.
- `front-end-web/src/App.jsx`: dùng chat wrapper tải trễ.
- `front-end-web/src/components/DeferredChatWidget.jsx`: tải chat theo tương tác.
- `front-end-web/src/components/ChatWidget.jsx`: nhận trạng thái mở ban đầu và giữ accessibility state.
- `front-end-web/src/components/RouteErrorBoundary.jsx`: fallback khi chunk/page lỗi.
- `front-end-web/src/App.css`: style cho route error fallback.
- `front-end-web/vite.config.js`: analyzer có điều kiện và proxy preview an toàn cho static assets.
- `front-end-web/package.json`, `package-lock.json`: thêm `rollup-plugin-visualizer` dev dependency.
- `front-end-web/e2e/performance-routes.spec.js`: smoke test production resources/chat.
- `front-end-web/scripts/responsive-smoke.mjs`: re-query nút chat sau khi lazy component mount.

## Rủi ro còn lại và bước tiếp theo

1. Chunk Recharts dùng chung vẫn lớn (358.46 kB raw). Nó đã rời initial load, nhưng dashboard đầu tiên vẫn phải tải chunk này. Chỉ cân nhắc thay thư viện hoặc chart implementation sau khi có route-level performance profile và regression test trực quan.
2. React DOM/Router vẫn chiếm phần lớn entry; đây là runtime nền tảng. Cần đo Lighthouse/Web Vitals trên môi trường có backend trước khi cân nhắc SSR hoặc thay đổi kiến trúc.
3. 11 lint warnings cần test component/API lifecycle trước khi refactor; không nên coi việc giảm warning là mục tiêu độc lập.
4. Cần chạy lại authenticated route matrix với development backend để xác minh lazy route trong session thực và tách lỗi performance khỏi lỗi Admin 403 đã biết.

