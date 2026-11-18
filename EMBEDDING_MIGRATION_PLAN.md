# Gemini Embedding Migration Plan — Job Connect

Ngày lập kế hoạch: **2026-11-03** (Asia/Saigon)

## 1. Trạng thái và nguồn chính thức

Google đã shutdown `text-embedding-004` ngày **2026-01-14** và chỉ định
`gemini-embedding-2` là model thay thế. `gemini-embedding-2` là model stable hiện còn được hỗ trợ,
input tối đa **8.192 token**, output linh hoạt **128–3.072 chiều**; Google khuyến nghị 768, 1536
hoặc 3072 chiều.

Nguồn:

- [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
- [Gemini Embedding 2 model](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2)
- [Embeddings guide](https://ai.google.dev/gemini-api/docs/embeddings)
- [EmbedContent API](https://ai.google.dev/api/embeddings)
- [API errors](https://ai.google.dev/gemini-api/docs/api-errors)
- [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)

## 2. Audit implementation hiện tại

- `matching.service.js` gọi REST
  `POST /v1beta/models/{model}:embedContent` bằng `fetch`; package chưa cài `@google/genai`.
- Request hiện chỉ gửi `model` và `content`; chưa cố định `taskType`, `outputDimensionality` hoặc
  `autoTruncate`.
- Model mặc định là `text-embedding-004` qua `GEMINI_EMBEDDING_MODEL`.
- Cache key là SHA-256 của `model + newline + raw text`. Key chưa chứa API version, task type,
  dimension, truncation policy, cache format version hoặc input fingerprint tách biệt.
- `EmbeddingCache.vector` là Prisma `Json`, đủ lưu vector 768 chiều. `contentHash CHAR(64)` đủ lưu
  SHA-256; `model VARCHAR(100)` đủ lưu model code. Không cần đổi schema cho cache namespace mới.
- `MatchScoreV2` có `semanticScore NOT NULL` và unique `(candidateId, jobId)`. Nếu ghi V3 vào bảng
  này, V2 sẽ bị overwrite, không đáp ứng rollback/song song. Không kích hoạt ghi V3 vào bảng này
  trước khi có storage versioned bổ sung.

## 3. Quyết định V3

Algorithm ID: **`weighted-v3-ge2-768-sts-prefix-v1`**.

V3 giữ nguyên toàn bộ trọng số V2:

```text
skill=.40, experience=.15, position=.10, location=.05,
salary=.05, employment=.05, semantic=.20
```

Embedding contract:

| Thuộc tính | V3 |
|---|---|
| Provider/model | Gemini Developer API / `gemini-embedding-2` |
| API | REST `v1beta models.embedContent` |
| Task instruction | Prefix `task: sentence similarity \| query: ` cho cả candidate profile và job text |
| Dimension | 768 |
| Auto truncate | `false`; không âm thầm cắt input |
| Input | Text hiện có của candidate/job; content role được đưa vào cache key |
| Timeout | 8.000 ms mặc định, cấu hình riêng |
| Retry | Tối đa 2 retry cho 408, 429 và 5xx; exponential backoff + jitter |

Đây là bài toán symmetric semantic similarity vì hệ thống so sánh trực tiếp hai văn bản trong cùng
không gian. Tài liệu hiện hành của Google không cho `gemini-embedding-2` dùng trường `taskType`;
task phải được thể hiện bằng prefix trong text. Nếu sau này chuyển sang retrieval hai tầng, phải tạo
version/cache namespace khác với prefix query/document tương ứng; không trộn hai contract.

Gemini không trả một immutable backend revision trong `embedContent` response. Trường
`GEMINI_EMBEDDING_V3_MODEL_VERSION` vì vậy là application-controlled deployment label dùng cho
cache/reproducibility, không phải revision do Google chứng thực. Khi Google công bố model code mới,
phải đổi cả model code, label và algorithm version. Code không tự đếm token theo tokenizer của
Google; `autoTruncate=false` buộc API từ chối input vượt 8.192 token thay vì cắt âm thầm.

Tiếp tục dùng REST trong bước này để tránh thêm dependency và lockfile khi API hiện tại đã dùng
REST. SDK chính thức cho Node là `@google/genai`, gọi `ai.models.embedContent({ model, contents,
config })`; có thể migrate transport riêng sau khi V3 được đánh giá, không được làm thay đổi
algorithm/cache namespace ngầm.

## 4. Cache namespace và tương thích

Tạo input fingerprint:

```text
inputFingerprint = SHA256(exact UTF-8 input text)
```

Tạo cache key từ canonical JSON của:

```json
{
  "cacheKeyVersion": "gemini-embedding-cache-v3",
  "provider": "google-gemini-developer-api",
  "apiVersion": "v1beta",
  "model": "gemini-embedding-2",
  "modelVersion": "gemini-embedding-2",
  "taskInstruction": "task: sentence similarity | query: ",
  "outputDimensionality": 768,
  "autoTruncate": false,
  "contentRole": "candidate-profile|job-document",
  "inputFingerprint": "sha256..."
}
```

`contentHash = SHA256(canonical JSON)`. Do not query V3 by legacy key, kể cả khi raw text giống nhau.
Cache hit phải kiểm tra `model`, vector length đúng 768 và mọi phần tử hữu hạn. Cache cũ được giữ
nguyên cho rollback/forensics; không xóa hoặc rewrite.

## 5. Fallback và failure semantics

Trình tự V3:

1. Tính V1 deterministic trước.
2. Đọc V3 cache; nếu hit hợp lệ thì không gọi API.
3. Nếu miss, gọi Gemini với timeout/retry có giới hạn.
4. Nếu embedding thành công, trả V3 đầy đủ, mọi score hữu hạn trong `[0,100]`.
5. Nếu thiếu key, timeout, 429/quota, 4xx hoặc hết retry 5xx: trả **explicit V1 fallback** với
   `algorithmVersion='weighted-v1'`, `requestedAlgorithmVersion='weighted-v3-ge2-768-sts-prefix-v1'`,
   `semanticScore=null`, `degraded=true` và reason machine-readable. Không gắn nhãn V3 cho điểm
   không có semantic component; không coi lỗi là semantic score 0.

Fallback object chưa được nối vào route/storage production trong bước này vì `semanticScore` của
`MatchScoreV2` là NOT NULL và unique key không versioned. Đây là chủ ý để không phá API contract hoặc
overwrite V2.

## 6. Rollout theo bước nhỏ

1. **Plan/audit** — tài liệu này; không mutation dữ liệu.
2. **Config song song** — thêm env V3 riêng, giữ `GEMINI_EMBEDDING_MODEL` legacy.
3. **Service V3 không kích hoạt** — cache key V2, request config, timeout/retry/fallback; export hàm
   cho evaluator/tests, chưa nối route.
4. **Tests** — model/config trong request, cache isolation, input/config fingerprint, invalid cache,
   timeout/429/5xx/non-retryable, fallback identity và finite scores.
5. **Offline evaluation** — chạy V1/V2/V3 trên cùng ground truth đã xác minh; đo quality và
   cold/warm latency. Không đổi weights trong bước migration.
6. **Storage additive trước activation** — đề xuất bảng `MatchScoreV3` hoặc unique
   `(candidateId, jobId, algorithmVersion)` cùng snapshot config. Migration chỉ additive, review và
   backup trước khi chạy; task hiện tại không tạo/chạy migration.
7. **Shadow/canary** — ghi V3 song song, không ảnh hưởng ranking; theo dõi 429, timeout, fallback,
   cache hit và score distribution.
8. **Promote/rollback** — feature flag chọn V3 sau quality gate. Rollback chỉ đổi flag về V2/V1;
   giữ cache/score cũ trong retention window. Cleanup là task riêng sau khi rollback window kết thúc.

## 7. Quality gate

- Không có `NaN`, `Infinity` hoặc dimension mismatch trong score/cache.
- Không có cache hit chéo model/task/dimension/role/input.
- 100% lỗi embedding trả fallback có reason, không giả semantic score 0.
- Full unit/integration suite pass.
- Precision@K, Recall@K, NDCG@K trên ground truth xác minh không kém ngưỡng product đã duyệt.
- P95 latency và fallback rate đạt SLO; quota lấy từ AI Studio theo project/tier tại thời điểm chạy.

## 8. Rollback và dữ liệu

Không xóa `embedding_cache`, `match_scores_v2` hoặc đổi legacy env trong rollout này. V3 cache dùng
hash namespace mới nên cùng tồn tại với V2. Không chạy `prisma migrate`, `db push`, cleanup SQL hoặc
backfill production trong task này.

## 9. Trạng thái triển khai trong task này

- Hoàn tất bước 1–4: plan, config song song, V3 service chưa kích hoạt, regression tests.
- Chưa thực hiện bước 5: dataset ground truth hiện chưa đủ điều kiện đánh giá chính thức.
- Chưa thực hiện bước 6–8: không tạo/chạy migration, không backfill, không nối route, không ghi đè
  score V2 và không xóa cache cũ.
