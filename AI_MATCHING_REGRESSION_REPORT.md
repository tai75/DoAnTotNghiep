# AI Matching Regression Report — Job Connect

Ngày kiểm tra: 2026-11-04  
Phạm vi: regression cục bộ, mock provider/API. Không gọi Gemini thật, không thay thuật toán/weights/thresholds và không tạo benchmark metrics từ dataset chưa xác minh.

## Kết luận

- **V1: GO có điều kiện** làm mặc định tạm thời. Score V1 độc lập Gemini và fallback explanation đã pass.
- **V2 legacy: NO-GO**. Source được giữ nguyên nhưng frontend, backend route và service đều disabled-by-default.
- **V3: NO-GO cho user traffic**. Không có public route/UI; mock contract pass nhưng chưa có live staging evidence hoặc human ground truth.

## Đã thực hiện và có bằng chứng

| Kiểm tra | Kết quả |
|---|---|
| Full backend Vitest | **PASS — 12/12 files, 95/95 tests** |
| Frontend lint | **PASS — exit 0**, 11 warning React có sẵn, 0 error |
| Frontend production build | **PASS — 640 modules** |
| Matching E2E trên production preview, API mock | **PASS — 1/1**; chỉ gọi `/api/jobs/1/match`, không gọi `/match/v2` |
| Public/performance E2E trên production preview | **PASS — 3/3** |
| V2 disabled HTTP contract | Candidate nhận 410; wrong role nhận 403; disabled request không đọc DB/cache/provider |
| Frontend V2 gate | `matchV2` reject local 410 khi flag không phải `true`; normal source không có caller |
| V3 disabled | Explicit degraded V1 với reason `version_disabled`; không được tính là V3 PASS |
| CV privacy/RBAC | Unrelated candidate và recruiter không có application nhận 403 |

Lần chạy E2E matching song song với performance test từng gặp `ENOENT` khi hai Playwright process dùng chung thư mục trace. Không có assertion nghiệp vụ fail; chạy lại tuần tự đạt 1/1. Kết quả release dùng lần chạy tuần tự.

## Endpoint/version thực tế

| Endpoint/flow | Version | User traffic | Gemini dependency |
|---|---|---:|---|
| `GET /api/jobs/:id/match` | V1 `weighted-v1` | Có, frontend hiện dùng | Score không; explanation optional + rule fallback |
| `GET /api/jobs/:id/match/v2` | V2 legacy | Không | Bị chặn 410 trước DB/cache/provider khi disabled |
| Recommendation jobs/candidates | V1 | Có | Score không; explanation có fallback |
| Apply/persist score | V1 | Có | Không |
| Recruiter talent search score | V1 | Có | Không |
| CV-job analysis button | V1 score + Gemini analysis riêng | Explicit action | V1 score vẫn độc lập; analysis cần provider |
| V3 public endpoint | Không tồn tại | Không | Chỉ evaluator/test |

## Version gates

- Backend flags `MATCHING_V2_ENABLED` và `MATCHING_V3_ENABLED` dùng strict boolean, mặc định false.
- V2 route gate chạy sau authentication/RBAC và trước matching data/provider work.
- `calculateWeightedV2` có service gate thứ hai để chặn caller nội bộ bypass route.
- Frontend `VITE_MATCHING_V2_ENABLED` mặc định false; normal UI chỉ gọi V1.
- V3 không có public route hoặc frontend call site. Disabled/fallback metadata phân biệt requested version và actual V1 algorithm.
- Source V2 và model `text-embedding-004` được giữ nguyên; không thay model trực tiếp, không trộn cache/embedding với V3.

## HTTP 410 behavior

Contract hiện tại:

```json
{
  "success": false,
  "message": "Matching V2 is disabled",
  "details": {
    "code": "matching_version_disabled",
    "version": "v2"
  }
}
```

Frontend normal flow không gọi endpoint này. Helper legacy xử lý disabled bằng local rejection có `status: 410`, tránh network request. Authentication/RBAC vẫn ưu tiên: 401 nếu chưa đăng nhập, 403 nếu sai role, 410 cho candidate hợp lệ khi V2 disabled.

## Điều tra ChatWidget preload

Nguyên nhân của failure cũ: test có tên “production route smoke” từng chạy với Vite development server. Dev module graph không đại diện production chunk loading nên assertion resource timing có thể thấy module khác kỳ vọng.

Bằng chứng hiện tại:

- `DeferredChatWidget.jsx` dùng `lazy(() => import('./ChatWidget'))` và chỉ render sau click.
- Production build tạo file `ChatWidget-*.js` riêng.
- Trên `vite preview`, `/login` và `/jobs` không preload chunk cấm.
- Chunk ChatWidget chỉ được request sau tương tác; performance suite đạt 3/3.

Không sửa ChatWidget vì source và production behavior đúng; thay đổi lúc này không có căn cứ và có nguy cơ ảnh hưởng logic/UX.

## Chưa thực hiện / bị chặn / cần xác nhận

| Phân loại | Nội dung |
|---|---|
| Chưa thực hiện | Live Gemini integration; staging smoke; benchmark quality với human ground truth |
| Bị chặn bởi điều kiện an toàn | Chưa có staging key/project/quota/privacy setup; dataset hiện tại chưa đủ provenance/labels |
| Cần người dùng xác nhận | Chấp nhận HTTP 410 contract; sau này có cho phép synthetic live V3 smoke trên staging hay không |
| Không được thực hiện trong task | Deploy, real Gemini call, đổi weights/thresholds/model V2, benchmark metrics không hợp lệ |

## GO/NO-GO

| Version | Trạng thái | Điều kiện vận hành |
|---|---|---|
| V1 | **GO có điều kiện** | Giữ default; không tuyên bố ranking quality đã được human-validated |
| V2 legacy | **NO-GO** | Giữ cả backend/frontend flag false; 410 là expected behavior |
| V3 | **NO-GO user traffic** | Chỉ xem xét shadow/offline sau consent, staging-safe live test và ground truth |

