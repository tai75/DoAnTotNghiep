# AI Matching Version Audit — Job Connect

Ngày audit: 2026-11-04  
Phạm vi: backend matching/embedding/LLM services, routes, frontend API/UI call sites, evaluator, benchmark artifacts và regression tests.  
Giới hạn: không gọi Gemini thật; không deploy production; không migration dữ liệu; không thay weights, thresholds hoặc score semantics.

## Kết luận điều hành

- **V1 là implementation đang được frontend và các business flow sử dụng thực tế.** Scoring V1 là rule-based, deterministic và không phụ thuộc Gemini.
- Route V1 và recommendation có thử dùng Gemini để viết explanation nếu có key, nhưng mọi lỗi provider/missing key đều fallback về rule explanation. Score và ranking không đổi.
- **V2 legacy có một public endpoint** và trước audit có thể gọi thẳng `text-embedding-004`. Model này đã shutdown ngày 2026-01-14. V2 không có UI call site thực tế, nhưng helper frontend vẫn được export.
- **V3 không có API endpoint.** Nó chỉ được gọi từ evaluator khi có `--include-v3` và từ unit tests. V3 có cache identity tách biệt theo model/version/task/dimension/role/input và fallback V1 có metadata `degraded`.
- Safe gating đã được triển khai: V2/V3 mặc định disabled; V2 bị chặn ở frontend, backend route và service trước mọi cache/provider call; evaluator mặc định chỉ chạy V1.
- V3 mock contract khớp tài liệu Google hiện hành, nhưng chưa gọi Gemini thật và dataset chưa đủ human ground truth. Không được báo V3 PASS chỉ vì fallback V1 thành công.
- Kết luận release: **V1 GO có điều kiện làm default tạm thời; V2 NO-GO; V3 NO-GO cho user traffic, chỉ cho phép shadow/offline có cấu hình rõ ràng.**

## Endpoint và version thực tế

| Endpoint/flow | Version thực tế | Gemini trong score | Frontend sử dụng | Ghi chú |
|---|---|---:|---:|---|
| `GET /api/jobs/:id/match` | V1 `weighted-v1` | Không | Có, `JobBoardPage` | Gemini explanation là optional; fallback rule-based |
| `GET /api/jobs/:id/match/v2` | V2 `weighted-v2` | Có, embedding legacy | Không có UI call site | Mặc định trả 410 trước DB/cache/provider |
| V3 public API | Không tồn tại | — | Không | Chỉ evaluator/test |
| `GET /api/recommendations/jobs` | V1 | Không trong score | Có, `RecommendationsPage` | Optional Gemini explanation, fallback rule |
| `GET /api/recommendations/jobs/:jobId/candidates` | V1 | Không trong score | Có, recruiter dashboard | Optional Gemini explanation, fallback rule |
| `POST /api/applications/jobs/:jobId` | V1 | Không | Có | Persist `weighted-v1` khi apply |
| `GET /api/recruiters/talent` | V1 | Không | Có | Contact chỉ trả khi applied/invitation accepted |
| `POST /api/candidates/me/job-analysis/:jobId` | V1 score + Gemini CV analysis | Có cho phần analysis | Có, explicit button | Score V1 độc lập; analysis trả lỗi nếu Gemini unavailable |
| Chat tool `getRecommendations` qua `POST /api/ai/chat` | V1 | Chat dùng Gemini; tool score không | Có | Router cũng được mount dưới `/api/recommendations/chat` |
| Evaluator mặc định | V1 only | Không | N/A | V2 cần `--include-v2`; V3 cần `--include-v3` và flag |

Do `recommendations.routes` được mount ở cả `/api/recommendations` và `/api/ai`, các route trong router có alias dưới cả hai prefix. RBAC giống nhau; frontend chỉ dùng các URL liệt kê ở bảng trên.

## Call graph và fallback

### V1

`calculateMatchScore` dùng sáu component hiện hữu và giữ nguyên weights:

- skill 0.50
- experience 0.20
- position 0.10
- location 0.10
- salary 0.05
- employment 0.05

Hàm không đọc API key, không gọi `fetch`, không truy cập embedding cache. NaN/non-finite input bị reject; zero vector chỉ liên quan V2/V3 cosine và cũng bị reject.

Route match và recommendation chạy theo thứ tự:

1. Tính V1 score.
2. Thử lấy Gemini explanation nếu có key/quota.
3. Nếu thiếu key, timeout, rate limit hoặc provider lỗi, dùng `buildRuleExplanation`.
4. Persist score với `algorithmVersion: weighted-v1`.

CV-job analysis dùng V1 để tạo score/matched/missing skill trước, sau đó mới gửi CV text và job description tới Gemini khi người dùng bấm nút. Đây không phải fallback matching: nếu Gemini lỗi, V1 vẫn hoạt động nhưng phần CV analysis trả lỗi 5xx phù hợp.

### V2 legacy

Call path duy nhất trong runtime là route `/jobs/:id/match/v2` → `calculateWeightedV2` → legacy `embeddingFor` → `text-embedding-004`. Evaluator là caller offline thứ hai. Không có recommendation/application/recruiter service nào gọi V2 ngầm.

Sau thay đổi:

- `MATCHING_V2_ENABLED=false` mặc định.
- Route xác thực và RBAC trước, sau đó trả HTTP 410 với `details.code = matching_version_disabled`.
- Service tự gate, nên caller mới không thể vô tình bypass route.
- Frontend `jobsApi.matchV2` reject cục bộ khi `VITE_MATCHING_V2_ENABLED` không phải `true`.
- Evaluator mặc định skip V2; phải có cả `--include-v2` và backend flag explicit.
- Source V2, model setting và cache cũ được giữ nguyên; không đổi model trực tiếp.

### V3

`calculateWeightedV3` chỉ được import bởi evaluator/test. Khi disabled, hàm không gọi cache/provider và trả:

- `algorithmVersion: weighted-v1`
- `requestedAlgorithmVersion: weighted-v3-ge2-768-sts-prefix-v1`
- `degraded: true`
- `fallback.reason: version_disabled`
- `semanticScore: null`

Khi enabled nhưng provider lỗi, metadata fallback vẫn phân biệt timeout, quota/rate limit, configuration, invalid cache/vector và network. Evaluator coi mọi `degraded` là failure, nên fallback V1 không thể biến thành V3 PASS.

## Model và embedding contract

Đối chiếu tài liệu chính thức ngày audit:

- `text-embedding-004` đã shutdown ngày 2026-01-14; replacement là `gemini-embedding-2` theo [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations).
- `gemini-embedding-2` là stable model; hỗ trợ 128–3072 dimensions và Google khuyến nghị 768/1536/3072 theo [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings).
- Với semantic textual similarity trên Embedding 2, cùng prefix `task: sentence similarity | query: ` phải được áp dụng nhất quán cho cả hai input. V3 đang làm đúng điều này.
- `embedContentConfig.outputDimensionality = 768` và `autoTruncate = false` được đưa vào request và cache identity. Vector trả về phải đúng 768 chiều, hữu hạn và không phải zero vector.
- Embedding spaces giữa model/version không được trộn. V3 hash gồm cache-key version, provider, API version, model, model version, instruction, dimension, truncation, content role và input fingerprint; legacy cache không được reuse.
- Generative model mặc định `gemini-3.6-flash` là stable model ID hợp lệ theo [Gemini models](https://ai.google.dev/gemini-api/docs/models). Audit không đổi model này.

Lưu ý: code/mock contract hợp lệ không thay thế live integration test. Chưa có bằng chứng API key/quota/project permissions thực sự chấp nhận request V3 trong staging.

## Benchmark và human ground truth

- Artifact hiện tại báo `invalid-dataset` hoặc `insufficient-data`.
- Validation gần nhất có 0 query, 0 distinct job, 0 labeled pair và thiếu đủ relevance grades 0–3.
- Dataset cũ 50 rows có 49 pair không tồn tại trong database snapshot hiện tại và không có verified provenance.
- Evaluator được chạy lại ở safe default; nó dừng trước metric với thông báo thiếu provenance hai evaluator/snapshot hợp lệ. V2/V3 không được gọi.

Do đó không được dùng benchmark hiện tại để tuyên bố V1/V2/V3 có Precision/Recall/NDCG đạt yêu cầu hoặc V3 tốt hơn V1.

## Kết quả regression tests

| Nhóm | Kết quả |
|---|---|
| Targeted matching/LLM/integration | 61/61 pass |
| Full backend Vitest | 95/95 pass, 12/12 files |
| V1 deterministic, no Gemini | Pass; không gọi `fetch` |
| V1 recommendation without Gemini | Pass; score + rule explanation vẫn trả 200 |
| V2 disabled service | Pass; 410 error, 0 cache/provider call |
| V2 disabled route | Pass; candidate 410, wrong role 403, không đọc matching data |
| Frontend V2 disabled helper | Pass; reject local 410, không gọi network |
| V3 disabled | Pass; explicit degraded V1, reason `version_disabled`, không gọi provider |
| V3 contract/cache namespace | Pass bằng mock |
| Missing key, timeout, 429, transient 503, invalid/non-finite vector | Pass bằng mock |
| V3 fallback classification | Pass; fallback không được tính là V3 success |
| CV download privacy | Pass; unrelated candidate và recruiter không có application đều 403 |
| Frontend lint | Exit 0; 11 warning React có sẵn, 0 error |
| Frontend production build | Pass, 640 modules transformed |
| Dedicated matching E2E, API fully mocked | 1/1 pass; UI chỉ gọi `/api/jobs/1/match`, không gọi V2 |
| Existing public-route E2E subset | 2/3 pass; lazy ChatWidget test fail vì chunk đã preload trước click trên dev server, không liên quan matching |

Không test nào dùng Gemini thật. Integration test chủ động đặt API key rỗng; E2E matching mock toàn bộ `/api/**`.

## Thay đổi API contract

Response thành công V1/V2 không đổi. Thay đổi duy nhất ở runtime mặc định:

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

HTTP status: `410 Gone`. Authentication/RBAC vẫn chạy trước gate: unauthenticated nhận 401, sai role nhận 403.

## GO / NO-GO

| Version | Trạng thái | Lý do |
|---|---|---|
| V1 | **GO có điều kiện làm default tạm thời** | Deterministic, Gemini-independent score, regression và fallback pass; chưa đủ ground truth để tuyên bố chất lượng ranking |
| V2 legacy | **NO-GO** | Model shutdown; giữ source để audit/rollback nhưng feature flag phải false |
| V3 | **NO-GO cho user traffic** | Contract/mock/cache/fallback pass nhưng chưa live Gemini staging test và chưa có benchmark human-labeled hợp lệ |

Không được diễn giải V1 GO vận hành thành “AI quality validated”. Không được diễn giải V3 fallback thành V3 PASS.
