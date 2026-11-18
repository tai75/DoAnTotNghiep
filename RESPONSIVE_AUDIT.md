# Job Connect Responsive Audit

Ngày audit: 2026-11-03  
Phạm vi: `front-end-web` (React 19, Vite, React Router, Recharts)  
Viewport mục tiêu: 320, 375, 390, 430, 768, 1024 và 1440px

## 1. Phạm vi và phương pháp

Audit được thực hiện trên toàn bộ route, page, layout, component và CSS hiện có trước khi sửa source frontend. Kết quả dựa trên việc truy vết JSX/CSS thực tế và cấu hình Vite; chưa coi dữ liệu giả lập hoặc ảnh chụp tĩnh là bằng chứng browser test.

Mức ưu tiên:

- **P0**: chặn truy cập/chức năng hoặc làm route không thể dùng đúng.
- **P1**: vỡ bố cục, mất thao tác, overflow hoặc accessibility nghiêm trọng tại viewport mục tiêu.
- **P2**: trải nghiệm kém, vùng chạm nhỏ, nhãn/typography hoặc hành vi chưa nhất quán.
- **P3**: cải tiến chất lượng, không chặn luồng chính.

## 2. Bản đồ route và giao diện

### Shared

- `src/App.jsx`: BrowserRouter, AuthProvider, AppRoutes, ChatWidget.
- `src/routes/AppRoutes.jsx`: route guards theo guest/Candidate/Recruiter/Admin.
- `src/components/AppShell.jsx`: header, desktop navigation, search, notification, account menu, mobile bottom navigation.
- `src/components/ChatWidget.jsx`: chat nổi toàn cục.
- `src/components/ui/*`: Avatar, Badge, Button, Card, EmptyState, Modal, Skeleton, Tabs, Toast.
- CSS nền: `src/index.css`, `src/App.css`, `src/styles/tokens.css`, `src/components/AppShell.css`, `src/components/ui/ui.css`.

### Public

- `/login`, `/register`: `AuthPage.jsx`.
- `/jobs`, `/jobs/:id`: `JobBoardPage.jsx` gồm filter, danh sách job, job detail, match panel, apply wizard, job alert modal.
- `/companies/:id`: `CompanyPage.jsx`.
- CSS: `auth.css`, `board.css`.

### Candidate

- `/recommendations`: `RecommendationsPage.jsx`.
- `/profile`: `CandidateProfilePage.jsx`.
- `/alerts`: `AlertsPage.jsx`.
- `/my-jobs`: `MyJobsPage.jsx` (tab applied/saved).
- `/messages`: `MessagesPage.jsx` (Candidate và Recruiter dùng chung).
- Redirect tương thích: `/applications` và `/saved-jobs`.
- Các page cũ còn tồn tại nhưng không phải route đích chính: `CandidateApplicationsPage.jsx`, `SavedJobsPage.jsx`.
- CSS: `candidate.css`, `pages/profile.css`, `pages/alerts.css`, `pages/my-jobs.css`, `pages/messages.css`.

### Recruiter

- `/recruiter/*`: `RecruiterDashboardPage.jsx`, gồm dashboard, jobs/job wizard, applications, pipeline, candidate detail, company profile.
- `/recruiter/talent`: `RecruiterTalentPage.jsx`, talent search/filter, saved search, chart, candidate rows.
- `/messages`: `MessagesPage.jsx`.
- CSS: `recruiter.css`, `pages/messages.css`.

### Admin

- `/admin/*`: `AdminDashboardPage.jsx`, gồm overview, users, companies, jobs/moderation và tables/charts.
- CSS: `admin.css`.

## 3. Breakpoint hiện tại

CSS đang dùng nhiều breakpoint rời rạc: 980, 900, 820, 800, 760, 700, 680, 650, 620, 600, 440 và 420px. Chúng có một số fallback hợp lý (form một cột, table scroll, public job master/detail), nhưng chưa tạo thành hệ responsive thống nhất. Khoảng 768–1024px và 320–430px dễ phát sinh hành vi khác nhau giữa các khu vực.

Đề xuất giữ kiến trúc CSS hiện tại, bổ sung quy ước thực dụng:

- `<= 1024px`: compact desktop/tablet, chart và grid giảm cột.
- `<= 768px`: mobile navigation/drawer, form một cột, master–detail.
- `<= 480px`: compact spacing/typography cho 320–430px.

## 4. Danh sách vấn đề

### Shared layout và component

| Ưu tiên | File | Phát hiện | Ảnh hưởng / hướng xử lý |
|---|---|---|---|
| P1 | `components/AppShell.jsx`, `AppShell.css` | Không có hamburger menu. Mobile chỉ ẩn một phần nav và thêm bottom nav; account menu vẫn gắn trong vùng desktop. | Navigation thiếu nhất quán, khó truy cập đủ route. Tạo nút hamburger có `aria-expanded`, drawer, overlay, close/Escape và đóng khi đổi route. |
| P1 | `components/AppShell.css` | Search/header vẫn cùng một hàng ở chiều rộng 320px; nhiều link chỉ có padding nhỏ, font 11px. | Có thể ép/overflow và vùng chạm dưới 44px. Chuyển search sang hàng riêng hoặc ẩn hợp lý trong drawer; chuẩn hóa touch target. |
| P1 | `components/ChatWidget.jsx`, `board.css` | Panel cố định 320×400px, offset 24px; không tính bottom nav/safe area. | Sát hoặc vượt viewport 320px, che navigation. Dùng `calc(100vw - ...)`, `dvh`, safe-area và mobile bottom offset. |
| P1 | `components/ui/Modal.jsx`, `ui.css` | Modal có max-height/scroll nhưng thiếu body scroll lock, Escape/focus restore; `id="ui-modal-title"` cố định có thể trùng. | Background vẫn cuộn, accessibility kém. Sinh id riêng, quản lý Escape/focus và chiều cao bằng `dvh`. |
| P2 | `components/ui/ui.css`, nhiều CSS page | Button/icon button nhiều nơi dưới 44×44px. | Khó thao tác bằng cảm ứng. Tăng `min-height/min-width` có chọn lọc ở mobile. |
| P2 | `index.html` | `lang="en"`, title mặc định `front-end-web`. | Không phản ánh nội dung tiếng Việt. Đổi `lang="vi"`, title Job Connect. |
| P2 | `auth.css` | Font tải trực tiếp qua Google Fonts `@import`. | Font có thể thay đổi/không tải khi offline; fallback hiện có nhưng cần thống nhất stack. Không chặn responsive. |

### Routing

| Ưu tiên | File | Phát hiện | Ảnh hưởng / hướng xử lý |
|---|---|---|---|
| P0 | `routes/AppRoutes.jsx` | `/recruiter/*` được khai báo trước `/recruiter/talent`. Cần xác minh cơ chế xếp hạng route của phiên bản Router thực tế, tránh dashboard wildcard nuốt trang talent. | Route talent có nguy cơ không tới được. Kiểm thử route và sắp route cụ thể trước wildcard nếu cần; không đổi auth/authorization. |

### Public

| Ưu tiên | File | Phát hiện | Ảnh hưởng / hướng xử lý |
|---|---|---|---|
| P1 | `JobBoardPage.jsx`, `board.css` | Filter chỉ đổi thành grid ở mobile, chưa có panel/drawer, nút mở và nút xóa filter rõ ràng. | Chiếm nhiều chiều cao, không đáp ứng yêu cầu filter mobile. |
| P1 | `board.css` | Public jobs dùng `:has()` để chuyển list/detail trên mobile, chưa có fallback class rõ ràng; detail action có thể ép hai nút. | Rủi ro compatibility và overflow ở 320px. Điều khiển bằng class/state và stack action tại viewport hẹp. |
| P1 | `JobBoardPage.jsx` | Job card là phần tử click/keyboard tự quản lý; save button lồng trong vùng tương tác. | Focus/activation có thể không nhất quán. Giữ logic, củng cố semantics và focus-visible. |
| P1 | `board.css` | Filter desktop có input/select `min-width: 110px`; job layout tối thiểu 330px cho cột list. | Tablet hẹp dễ nén hoặc overflow trước breakpoint. |
| P2 | `AuthPage.jsx`, `auth.css` | Layout chuyển từ hai cột sang một cột ở 820px khá tốt; mobile 320px vẫn cần kiểm tra form-meta/password/touch target. | Có nguy cơ wrap không đẹp, chưa chặn chức năng. |
| P2 | `CompanyPage.jsx`, `board.css` | Header chuyển `display:block` ở mobile nhưng action/card spacing và chuỗi dài chưa được kiểm soát đầy đủ. | URL/tên công ty dài có thể overflow. |
| P2 | `board.css` | Có ký tự mojibake `â€¢` trong pseudo-element cũ. | Hiển thị tiếng Việt/ký hiệu không nhất quán. |

### Candidate

| Ưu tiên | File | Phát hiện | Ảnh hưởng / hướng xử lý |
|---|---|---|---|
| P1 | `MessagesPage.jsx`, `pages/messages.css` | Mobile vẫn xếp danh sách hội thoại trên panel chat; không có chế độ “list hoặc chat” và nút quay lại. | Không đạt yêu cầu master–detail mobile, vùng đọc chat thấp. |
| P1 | `CandidateProfilePage.jsx`, `pages/profile.css` | Profile tabs wrap tự do; resource item và completion/header có xử lý một phần nhưng button/input chưa tối ưu 320px. | Tab nhiều dòng, nút nhỏ, nội dung dài gây layout kém. |
| P1 | `CandidateProfilePage.jsx` | `ResumeSection` có hai khối `return` liên tiếp; khối sau không thể chạy. | Code dead/unreachable gây khó bảo trì và có thể che sai lệch UI. Không tự đổi nghiệp vụ; chỉ loại phần unreachable nếu lint/build xác nhận. |
| P1 | `RecommendationsPage.jsx`, `board.css` | Grid `minmax(280px, 1fr)` cộng padding ngoài; score absolute có thể đè title dài. | 320px sát biên và nội dung tiếng Việt dài dễ va chạm. |
| P2 | `AlertsPage.jsx`, `alerts.css` | Form đã một cột dưới 650px, nhưng action card/form không wrap/stack đầy đủ. | Nút có thể chật ở 320–375px. |
| P2 | `MyJobsPage.jsx`, `my-jobs.css` | Tabs scroll được nhờ UI shared; card actions chỉ wrap, summary và title/status dài chưa có min-width/word-break. | Có thể tràn nội dung trong dữ liệu thật. |
| P2 | `CandidateApplicationsPage.jsx`, `SavedJobsPage.jsx`, `candidate.css` | Page legacy có responsive cơ bản nhưng chưa thuộc route chính. | Giữ tương thích, kiểm tra tĩnh; ưu tiên thấp hơn route active. |

### Recruiter

| Ưu tiên | File | Phát hiện | Ảnh hưởng / hướng xử lý |
|---|---|---|---|
| P1 | `RecruiterDashboardPage.jsx`, `recruiter.css` | Desktop sidebar ở mobile biến thành thanh nav ngang, không phải drawer; không có overlay/nút đóng. | Không đạt yêu cầu, chiếm chiều cao và khó quản lý nhiều mục. |
| P1 | `recruiter.css` | `.recruiter-main` có `max-width` nhưng thiếu `min-width:0`/width rõ ràng; tables/pipeline chứa vùng rất rộng. | Grid/flex child có thể làm toàn trang overflow. |
| P1 | `RecruiterDashboardPage.jsx`, `recruiter.css` | Pipeline 8 cột có scroll ngang nhưng thiếu region label/keyboard affordance và drawer detail chưa có overlay/scroll lock. | Scroll có kiểm soát chưa đủ, detail che toàn màn hình mobile. |
| P1 | `RecruiterDashboardPage.jsx` | Vertical chart dùng Y axis cố định 150px; pie label và chart card padding lớn. | Chart chật/nhãn cắt ở 320–768px. |
| P1 | `RecruiterDashboardPage.jsx`, `recruiter.css` | Job wizard có nhiều inline editors; question editor/suggestion filters chưa có mobile grid rules đầy đủ. | Input/nút dễ overflow và action quá dày. |
| P1 | `RecruiterTalentPage.jsx`, `recruiter.css` | Filters luôn hiển thị; mobile chỉ giảm còn hai cột, chưa có panel/drawer và clear filter. | Chiếm nhiều màn hình, không đạt yêu cầu filter drawer. |
| P2 | `recruiter.css` | Table đã có wrapper scroll nhưng không có mô tả vùng cuộn/sticky action; cell action dài. | Có thể dùng được nhưng discoverability thấp. |
| P2 | `RecruiterDashboardPage.jsx` | Candidate/application detail là block trong trang; close button nhỏ và thiếu accessible label. | Touch/accessibility kém. |

### Admin

| Ưu tiên | File | Phát hiện | Ảnh hưởng / hướng xử lý |
|---|---|---|---|
| P1 | `AdminDashboardPage.jsx`, `admin.css` | Sidebar mobile biến thành nav ngang, không phải drawer, logout đặt absolute. | Không đạt yêu cầu drawer; dễ chồng brand/profile ở 320px. |
| P1 | `AdminDashboardPage.jsx` | Overview chart dùng inline flex, gap và height cố định; hai `ResponsiveContainer` là flex child không có wrapper width ổn định. | Chart có thể tính width bằng 0 hoặc quá hẹp ở tablet/mobile. |
| P1 | `admin.css` | Stat grid chỉ giảm 4→2 cột, chưa xuống 1 cột tại 320px; header/action chưa wrap đầy đủ. | Card nén, text/action va chạm. |
| P1 | `admin.css` | Table có wrapper scroll và min-width 640px (phương án hợp lệ) nhưng thiếu affordance/aria cho vùng scroll. | Người dùng mobile khó nhận biết có thể cuộn ngang. |
| P2 | `AdminDashboardPage.jsx` | Moderation/action buttons nhỏ; chuỗi email/title dài chủ yếu ellipsis. | Touch target nhỏ, khó đọc dữ liệu quan trọng. |

## 5. Rủi ro horizontal overflow cụ thể

- Flex/grid child thiếu `min-width: 0`: recruiter main, chart wrappers, một số card body/action.
- Input/select có min-width cứng trong filter và application actions.
- Fixed panel: global chat 320px + offset, pipeline drawer padding trên viewport 320px.
- Grid min column: public jobs 330px, recommendation 280px cộng padding, talent 130/150px.
- Chuỗi không ngắt: email, URL công ty, title dài, skill/chip và button label.
- Không dùng `overflow-x: hidden` toàn trang để che các lỗi trên; từng vùng rộng sẽ có layout/scroll container có chủ đích.

## 6. Kế hoạch triển khai theo nhóm

1. **Shared Layout**: AppShell hamburger/drawer, modal accessibility/viewport, ChatWidget, touch/focus primitives, ngôn ngữ document.
2. **Public**: Job filter drawer/clear, list–detail mobile, job cards/actions, auth/company compact layout.
3. **Candidate**: Messages master–detail, profile/recommendations/alerts/my-jobs và legacy route safety.
4. **Recruiter**: sidebar drawer, responsive charts/forms/tables/pipeline, talent filter panel.
5. **Admin**: sidebar drawer, chart wrappers, stat grid, table scroll affordance.

Mỗi nhóm phải qua lint/build hoặc kiểm tra mục tiêu phù hợp trước khi chuyển nhóm. Business logic, API, auth/authorization và desktop UI không được thay đổi ngoài phần cần thiết cho responsive/accessibility.

## 7. Điều kiện kiểm thử

- Chạy `npm run lint` và `npm run build`, ghi đúng kết quả thật.
- Kiểm tra route theo role và các viewport mục tiêu nếu có browser automation.
- Tương tác bắt buộc: hamburger/drawer/overlay/Escape, modal, job filters/clear, form, table scroll, chart, messages back flow và ChatWidget.
- Trang không thể kiểm tra do thiếu account/data/backend phải được ghi rõ là chưa kiểm tra; không suy diễn thành pass.
