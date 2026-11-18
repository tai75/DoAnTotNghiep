# Staging Verification Checklist — Job Connect

Điền ngày, commit SHA, tester, thiết bị, browser và URL staging. Không ghi password/token vào checklist.

## A. Release gate

- [ ] Có phê duyệt rõ ràng để tạo tài nguyên/deploy/phát sinh chi phí.
- [ ] Commit SHA đã khóa; worktree release sạch; lockfiles được dùng với `npm ci`.
- [ ] Secret scan pass; không có `.env`, CV, dump DB, Gemini/SMTP/JWT key trong Git/build artifact.
- [ ] Baseline migration đã pass trên MySQL trắng; `db:migrate:status` báo up to date.
- [ ] Backup DB và volume đã tạo; restore drill gần nhất có bằng chứng.
- [ ] Database là staging riêng và chỉ có synthetic data.
- [ ] Một backend replica; cron mặc định disabled.

## B. Network, HTTPS và headers

- [ ] Frontend/API chỉ truy cập qua HTTPS; HTTP redirect sang HTTPS tại edge.
- [ ] `/api/health/live` trả 200; `/api/health/ready` trả 200 khi DB hoạt động.
- [ ] Khi ngắt DB trong maintenance test, readiness trả 503 mà không lộ connection string.
- [ ] Origin ngoài allowlist bị CORS block; frontend staging được phép với credentials.
- [ ] Login response đặt refresh cookie `HttpOnly`, `Secure`, đúng `SameSite`, path `/api/auth`.
- [ ] Cookie/JWT không xuất hiện trong URL, localStorage, console hoặc access log.
- [ ] `X-Request-Id` có trên response; request ID tra được trong log.
- [ ] Rate limit dùng client IP đúng sau proxy; không gom mọi người dùng thành một proxy IP.
- [ ] Helmet/CSP không làm hỏng Vite chunks, fonts hoặc API calls.

## C. SPA và lazy routes

Mở trực tiếp và hard refresh từng route:

- [ ] `/jobs` và `/jobs/<valid-id>`.
- [ ] `/companies/<valid-id>`.
- [ ] `/login`, `/register`.
- [ ] Candidate: `/profile`, `/recommendations`, `/alerts`, `/my-jobs`, `/messages`.
- [ ] Recruiter: `/recruiter`, `/recruiter/talent`, `/messages`.
- [ ] Admin: `/admin` (không quay/chụp credential).
- [ ] Route không tồn tại về UI phù hợp, không phải host 404.
- [ ] Lazy chunks trả đúng MIME JavaScript, không trả `index.html`.
- [ ] Refresh khi đã login phục hồi session; role guard không nhấp nháy/lộ trang sai role.
- [ ] Rollback frontend một version không gây `ChunkLoadError`.

## D. Candidate desktop

- [ ] Đăng nhập tài khoản Candidate synthetic; logout rồi refresh token không còn dùng được.
- [ ] Xem/filter job, mở chi tiết company/job.
- [ ] Sửa profile và skills; dữ liệu còn sau refresh.
- [ ] Upload PDF và DOCX hợp lệ ≤5 MB.
- [ ] File >5 MB, sai extension/MIME/signature bị từ chối.
- [ ] Tải CV bằng chính Candidate; Candidate khác không tải được.
- [ ] Restart/redeploy backend rồi tải lại CV thành công.
- [ ] Save job, apply bằng CV, xem/rút application.
- [ ] Tạo alert, notification và message.
- [ ] Resume import/analysis chỉ dùng CV synthetic; UI xử lý Gemini timeout/429.

## E. Recruiter desktop

- [ ] Đăng nhập Recruiter synthetic; không truy cập được Candidate/Admin route.
- [ ] Sửa company, upload JPG/PNG hợp lệ ≤2 MB; logo còn sau restart.
- [ ] Tạo/sửa/submit job; admin có thể moderate; job xuất hiện đúng trạng thái.
- [ ] Xem application của đúng company; company khác bị 403/404.
- [ ] Tải CV chỉ khi có application thuộc company.
- [ ] Talent search/invite, notes, status và conversation hoạt động.
- [ ] AI job description dùng key staging; không hiện raw provider error/key.

## F. Admin riêng tư

- [ ] Admin account chỉ tồn tại trong staging, không liên kết dữ liệu thật.
- [ ] Password Admin khác Candidate/Recruiter và nằm trong password manager.
- [ ] Admin credential không nằm trong README, slide, chat công khai, video hoặc QR code.
- [ ] Admin xem stats/audit, moderate job/review, lock/unlock synthetic user.
- [ ] Candidate/Recruiter không gọi được `/api/admin/*`.
- [ ] Có thao tác rotate/disable Admin ngay sau bảo vệ.

## G. Email, cron, AI và persistence

- [ ] Password-reset email xuất hiện trong Mailtrap Sandbox, không gửi tới mailbox thật.
- [ ] Reset link dùng frontend staging HTTPS và dùng được đúng một lần.
- [ ] `worker:alerts:once` tạo đúng một notification/email; chạy lại không gửi trùng ngoài kỳ hạn.
- [ ] `ALERT_WORKER_ENABLED=false` sau test, hoặc chỉ một worker được bật.
- [ ] Gemini model/key/quota staging đã xác minh trong AI Studio; billing alert bật.
- [ ] Khi bỏ Gemini key, chức năng không-AI vẫn hoạt động và UI báo lỗi có kiểm soát.
- [ ] CV/logo còn sau process restart và full redeploy.
- [ ] Disk usage/backup được quan sát; không có file orphan rõ ràng sau test delete.

## H. Điện thoại thật

Thử tối thiểu một Android Chrome và một iPhone Safari nếu có:

- [ ] Truy cập qua 4G/5G và Wi-Fi, chứng chỉ HTTPS hợp lệ.
- [ ] Login, đóng/mở browser, refresh session hoạt động; Safari không chặn refresh cookie same-origin.
- [ ] Không có horizontal scroll ở 320–430 px; menu, dialog, bảng có thể thao tác.
- [ ] Keyboard không che input/login/chat; focus và nút back hoạt động.
- [ ] Chọn/upload CV từ Files/Drive; lỗi kích thước/định dạng hiển thị rõ.
- [ ] Job search/filter/detail, save/apply chạy được.
- [ ] Messages/notifications không che nội dung; touch target đủ lớn.
- [ ] Mạng chậm/offline rồi online lại không tạo duplicate application/message.
- [ ] Direct link từ email vào `/jobs/<id>` mở đúng app sau hard navigation.

## I. Observability và rollback rehearsal

- [ ] External monitor gọi readiness bằng HTTPS và gửi được cảnh báo thử.
- [ ] Log có startup/shutdown, 5xx, worker error, SMTP/Gemini lỗi nhưng không có PII/secret.
- [ ] Dashboard theo dõi CPU, memory, DB connection, disk, 4xx/5xx và latency.
- [ ] Rollback frontend/backend về deployment trước đã rehearsal.
- [ ] Restore DB vào instance mới và đổi connection đã rehearsal hoặc có bằng chứng gần nhất.
- [ ] Đối chiếu DB/volume sau restore.
- [ ] Có local fallback demo (video/screenshots + local seed) nếu Internet/PaaS lỗi ngày bảo vệ.

## J. Sign-off

- [ ] Dev sign-off.
- [ ] QA/mobile sign-off.
- [ ] Data/privacy sign-off: synthetic only.
- [ ] Người chịu trách nhiệm rollback và credential đã được chỉ định.
- [ ] Quyết định cuối: `GO` / `NO-GO`, thời gian và lý do được ghi lại.

