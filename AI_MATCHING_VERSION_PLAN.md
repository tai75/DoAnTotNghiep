# AI Matching Version Plan — Job Connect

Ngày lập kế hoạch: 2026-11-04  
Trạng thái: V1 default; V2/V3 disabled-by-default; chưa được phép gọi Gemini thật hoặc deploy production.

## Chính sách version hiện tại

| Version | Backend flag | Frontend flag | Cho user traffic |
|---|---|---|---|
| V1 | Không cần flag | Không cần flag | Có, default tạm thời |
| V2 legacy | `MATCHING_V2_ENABLED=false` | `VITE_MATCHING_V2_ENABLED=false` | Không |
| V3 | `MATCHING_V3_ENABLED=false` | Không có UI/route | Không; shadow/offline có kiểm soát |

Không thêm generic version selector từ request/query/body. Người dùng không thể tự chọn V2/V3. Không thay weights, thresholds, score semantics hoặc model V2.

## Các thay đổi đã thực hiện

### Backend

- Thêm parser strict cho `MATCHING_V2_ENABLED` và `MATCHING_V3_ENABLED`; chỉ nhận `true`/`false`, mặc định false.
- Gate V2 ở route sau authentication/RBAC và trước validation/data/provider work.
- Gate V2 lần hai trong `calculateWeightedV2` để ngăn caller nội bộ bypass.
- V3 disabled trả fallback V1 có `degraded: true` và reason `version_disabled`; không đọc cache hoặc gọi provider.
- Giữ nguyên source V2, `text-embedding-004`, weights và score semantics.
- Giữ nguyên V1 response success contract.
- Evaluator mặc định V1-only. V2 cần `--include-v2`; V3 cần `--include-v3` cộng flag.

### Frontend

- `jobsApi.matchV2` vẫn tồn tại nhưng reject cục bộ 410 khi build flag không bật.
- `JobBoardPage`, Recommendations và recruiter dashboard tiếp tục dùng V1.
- Thêm E2E mock xác minh UI không phát request `/match/v2`.

### Tests

- Thêm enabled/disabled flag regression.
- Thêm V1 no-Gemini và recommendation fallback.
- Thêm V3 disabled, timeout, quota/rate-limit, missing key, transient provider và invalid vector coverage.
- Thêm route 410/RBAC và CV privacy coverage.

## Cấu hình an toàn theo môi trường

### Development mặc định

```dotenv
MATCHING_V2_ENABLED=false
MATCHING_V3_ENABLED=false
VITE_MATCHING_V2_ENABLED=false
```

Nếu biến không tồn tại, code vẫn dùng false. File `.env` tại thời điểm audit không chứa hai matching flags và không chứa Gemini API key; do đó V2/V3 disabled và không có live Gemini call.

### Staging V1-only

- Giữ cả ba flag false.
- Gemini key có thể vắng mặt; matching/recommendation V1 vẫn phải hoạt động.
- CV analysis/chat/job-description sẽ báo unavailable hoặc dùng fallback riêng, không được làm hỏng V1 score.

### V3 shadow/offline sau khi được phê duyệt

```dotenv
MATCHING_V2_ENABLED=false
MATCHING_V3_ENABLED=true
GEMINI_EMBEDDING_V3_MODEL=gemini-embedding-2
GEMINI_EMBEDDING_V3_MODEL_VERSION=<PINNED_AND_RECORDED_VERSION>
GEMINI_EMBEDDING_V3_DIMENSIONS=768
```

Không tạo public V3 route ở bước này. Chỉ evaluator/shadow job được phép gọi, dùng synthetic hoặc consented data.

## Điều kiện để live-test Gemini V3

Phải có xác nhận riêng trước khi gọi thật và đồng thời thỏa:

1. Staging project/key riêng, quota/billing limit và alert đã cấu hình.
2. Không dùng production key hoặc development CV thật.
3. Dataset synthetic hoặc dữ liệu đã có legal/privacy consent.
4. Log redaction xác minh không ghi CV, prompt, API key hoặc raw embedding.
5. Model, model version, prefix, dimension và cache-key version được pin trong test evidence.
6. Cache namespace mới; không reuse legacy `text-embedding-004` hay model/version khác.
7. Test 200, missing key, 400, 408/abort, 429, 5xx và malformed vector.
8. Kết quả phải ghi riêng `requestedAlgorithmVersion`, `algorithmVersion`, `degraded`, provider status và cache hit/miss.
9. Một run fallback bất kỳ làm V3 run **unavailable/failed**, không phải PASS.

## Điều kiện để V3 có thể nhận user traffic

Ngoài live integration gate:

- Human-labeled dataset đạt tối thiểu 5 candidate queries, 10 jobs/query, đủ relevance 0–3 và hai evaluator.
- Quadratic weighted kappa đạt ngưỡng rubric hiện tại trước khi tính ranking metrics.
- So sánh V1/V3 trên cùng snapshot, cùng candidate/job pairs, cache state được ghi rõ.
- Review privacy cho profile/CV text gửi tới provider.
- Review latency, quota, cost, retry amplification và fallback UX.
- Canary/shadow evidence chứng minh không trộn embedding và không ghi V1 fallback thành V3 record.
- Có rollback bằng cách tắt `MATCHING_V3_ENABLED`; không cần migration dữ liệu.
- API response contract cho V3 phải được thiết kế/review trước khi thêm route.

Không tự động điều chỉnh weights/thresholds dựa trên dataset hiện tại.

## V2 legacy policy

- Giữ source code và test legacy để phục vụ forensic/comparison.
- Không thay `text-embedding-004` trực tiếp trong V2.
- Không bật V2 ở bất kỳ environment dùng user traffic.
- Không copy legacy cache sang V3.
- Nếu cần historical reproduction, dùng mock/fixture hoặc isolated research environment; model thật đã shutdown nên kết quả provider không còn tái tạo được.

## Monitoring và acceptance criteria

### V1

- 100% score/breakdown finite trong [0, 100].
- `algorithmVersion` persisted là `weighted-v1`.
- Gemini unavailable không làm matching/recommendation endpoint lỗi.
- Explanation luôn có rule-based fallback.
- RBAC và CV download authorization giữ nguyên.

### V2

- Default candidate request: 410 và code `matching_version_disabled`.
- Wrong role: 403; unauthenticated: 401.
- Disabled request: 0 embedding cache read/write, 0 provider call, 0 MatchScoreV2 write.
- Frontend default: 0 request tới `/match/v2`.

### V3 shadow

- Success chỉ khi `degraded === false`, `algorithmVersion` đúng requested version, vector đúng dimension và contract đồng nhất.
- Missing key/timeout/429/5xx/invalid vector: finite V1 fallback, `semanticScore: null`, reason machine-readable.
- Cache hit chỉ trong cùng full identity namespace.

## Test commands và kết quả hiện tại

```powershell
cd back-end
npm test

cd ..\front-end-web
npm run lint
npm run build
$env:QA_SKIP_AUTH_SETUP='1'
npx playwright test e2e/matching-version-gate.spec.js --project=desktop-1440
```

Kết quả:

- Backend: 95/95 pass.
- Frontend lint: exit 0, 11 pre-existing warnings, 0 errors.
- Frontend build: pass.
- Matching E2E mocked: 1/1 pass.
- Existing public-route subset: 2/3 pass; một unrelated lazy-chunk assertion fail và cần xử lý riêng.
- Safe evaluator: dừng trước metrics do thiếu verified provenance; không gọi V2/V3/Gemini.

## Việc còn cần xác nhận

1. Có chấp nhận HTTP 410 contract cho V2 legacy hay muốn dùng 404 để ẩn endpoint.
2. Có giữ frontend `jobsApi.matchV2` cho internal diagnostics hay loại khỏi public client surface trong release sau.
3. Khi có staging an toàn, có cho phép một live Gemini V3 smoke test bằng synthetic data hay không.
4. Ai là hai human evaluators và lịch hoàn thành dataset ground truth.
5. Có cần tách `/api/ai` và `/api/recommendations` routers để loại các alias route ngoài ý muốn hay không.

Cho đến khi các mục liên quan được phê duyệt: V1 tiếp tục là default, V2/V3 giữ disabled, không gọi Gemini thật và không deploy production.
