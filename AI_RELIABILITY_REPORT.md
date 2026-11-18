# AI Reliability Audit — Job Connect

Ngày audit: 2026-11-04  
Phạm vi: AI Matching V1/V2/V3, Gemini LLM, embedding cache, các unit/integration test liên quan.  
Nguyên tắc: không gọi Gemini thật, không gửi CV/PII ra ngoài, không đọc/in secret, không thay đổi Prisma schema, không chạy migration hoặc ghi database production.

## 1. Kết luận điều hành

Đã xác minh và sửa một lỗi có thể tạo `NaN` trong cosine similarity khi các phần tử vector hữu hạn nhưng đủ lớn để phép nhân/tổng bình phương bị tràn thành `Infinity`. Regression test thất bại trước bản sửa và thành công sau bản sửa. Phép tính mới scale hai vector trước khi tính cosine, nên giữ nguyên ý nghĩa cosine, miền score và toàn bộ matching weights.

Đồng thời đã sửa contract của Matching V3 theo tài liệu Gemini hiện hành: `gemini-embedding-2` không hỗ trợ trường `taskType`; semantic similarity dạng symmetric phải dùng cùng prefix `task: sentence similarity | query: ` cho cả hai đầu vào. Namespace cache và algorithm version được tăng để không tái sử dụng vector sinh theo contract cũ.

Luồng LLM hiện có timeout hữu hạn, retry có giới hạn cho lỗi tạm thời, không retry lỗi request 4xx không tạm thời, không để API key trong URL, và trả lỗi có phân loại. Chức năng sinh mô tả việc làm vẫn degrade về nhập thủ công khi Gemini lỗi. Matching V3 degrade về V1 và không ghi kết quả fallback vào bảng điểm V2.

Chưa có bằng chứng V2/V3 tốt hơn V1. Dataset 50 cặp hiện tại không đủ ground truth; vì vậy không đổi weights và không kích hoạt V3 cho production.

## 2. Phương pháp và bằng chứng

Đã đọc và đối chiếu:

- `back-end/src/services/matching.service.js`
- `back-end/src/services/llm.service.js`
- `back-end/src/services/embedding.service.js`
- `back-end/src/routes/jobs.routes.js` và các route CV/job liên quan
- `back-end/prisma/schema.prisma`
- `AI_EVALUATION.md`, `EMBEDDING_MIGRATION_PLAN.md`
- Các test matching, embedding cache/migration, LLM và route hiện có

Không gọi API ngoài trong test. Mọi response Gemini đều được mock; các giá trị nhạy cảm trong test chỉ là placeholder giả.

### Tái hiện lỗi trước khi sửa

Regression test dùng hai vector `[Number.MAX_VALUE / 2, Number.MAX_VALUE / 2]`. Mọi phần tử đều hữu hạn, nhưng cách tính trực tiếp làm dot product và norm tràn số, dẫn đến `Infinity / Infinity = NaN`.

Kết quả trước sửa:

```text
tests/matching.service.test.js: 1 failed, 12 passed
Error: Cosine similarity không hữu hạn
```

Kết quả sau sửa và kiểm thử đầy đủ:

```text
Targeted reliability suite: 4 files passed, 35 tests passed
Full backend suite:          11 files passed, 75 tests passed
Duration full suite:         3.85s
```

Lệnh kiểm thử:

```powershell
npx vitest run --configLoader native tests/matching.service.test.js tests/unit/matching-v3-migration.test.js tests/unit/matching-v2-cache.test.js tests/unit/llm-reliability.test.js
npm test
```

## 3. Findings đã xác minh

| ID | Mức độ | Finding | Bằng chứng đã sanitize | Trạng thái |
|---|---|---|---|---|
| AI-01 | High | Cosine similarity có thể thành `NaN` do overflow dù input hữu hạn | Regression test với `Number.MAX_VALUE / 2`; không chứa dữ liệu thật | Đã sửa và test |
| AI-02 | High | V2 mặc định dùng `text-embedding-004`, model đã ngừng hoạt động ngày 2026-01-14 | Default cũ trong `matching.service.js`; Google deprecation schedule | V2 legacy chưa được kích hoạt/migrate sang model mới |
| AI-03 | High | Default LLM `gemini-2.0-flash` đã ngừng hoạt động ngày 2026-06-01 | Default cũ trong `env.js`/`.env.example`; Google deprecation schedule | Default đã đổi sang `gemini-3.6-flash`; biến môi trường triển khai thực tế cần kiểm tra riêng |
| AI-04 | High | V3 gửi `taskType` không được `gemini-embedding-2` hỗ trợ | Request body cũ và tài liệu embedding chính thức | Đã sửa bằng symmetric task prefix; cache/algorithm version đã tăng |
| AI-05 | Medium | LLM request không có timeout/retry phân loại; có thể treo request hoặc retry sai loại lỗi | `llm.service.js` trước sửa gọi `fetch` trực tiếp | Đã thêm timeout, bounded retry và error classification |
| AI-06 | Medium | API key LLM nằm trong query string, dễ lộ qua proxy/access log | URL request cũ có `?key=...` | Đã chuyển sang header `x-goog-api-key` |
| AI-07 | Medium | Cache identity phải đổi khi model/contract/dimension/role thay đổi | Test cache key cho model version, dimension, task instruction, role | Đã version namespace và test isolation |
| AI-08 | Medium | Benchmark hiện không chứng minh V2 tốt hơn V1 | 49/50 cặp thiếu nhãn usable theo báo cáo evaluation hiện tại | Chưa sửa bằng code; cần dataset có ground truth |

## 4. Rủi ro giả định/chưa xác minh ở production

| ID | Mức độ | Rủi ro | Lý do chưa xác minh | Khuyến nghị |
|---|---|---|---|---|
| AR-01 | High | Deployment có thể đang override `GEMINI_MODEL` bằng model cũ | Audit không đọc/in secret hoặc cấu hình production | Kiểm tra tên biến bằng secret manager, không in value; rollout canary |
| AR-02 | High | `/jobs/:id/match/v2` legacy có thể lỗi do model embedding đã shutdown | Không gọi Gemini thật; endpoint V2 vẫn là implementation legacy | Feature-gate V2 hoặc route sang V3 sau benchmark; không ghi fallback V1 thành V2 |
| AR-03 | Medium | Retry đồng thời trên nhiều instance có thể khuếch đại quota/cost | Chưa có distributed quota/circuit breaker | Thêm quota per tenant/user, circuit breaker và metrics không chứa PII |
| AR-04 | Medium | Prompt injection trong CV/JD có thể ảnh hưởng kết quả phân tích | Không pentest với dữ liệu thật; prompt là untrusted content | Tách instruction/data, schema validation chặt, giới hạn output và đánh dấu kết quả AI là advisory |
| AR-05 | Medium | Cache DB tăng không giới hạn | Chưa có retention/eviction policy quan sát được | TTL/cleanup theo namespace sau thời gian rollback |
| AR-06 | Medium | CV/JD có thể được lưu trong log upstream khi lỗi | Không truy cập hạ tầng logging production | Chặn body/prompt ở access/error log, redact identifiers |

## 5. Bảng model/version

| Chức năng | Trước audit | Sau thay đổi code | Trạng thái chính thức tại ngày audit | Ghi chú |
|---|---|---|---|---|
| LLM mặc định | `gemini-2.0-flash` | `gemini-3.6-flash` | `gemini-2.0-flash` shutdown 2026-06-01; `gemini-3.6-flash` stable | Production env có thể override default |
| Embedding V2 legacy | `text-embedding-004` | Không tự động đổi | Shutdown 2026-01-14 | Giữ legacy để không âm thầm đổi score space; cần migration/benchmark |
| Embedding V3 | `gemini-embedding-2`, 768 chiều | Giữ model/dimension; sửa input contract | Stable; hỗ trợ 128–3072 chiều, khuyến nghị 768/1536/3072 | 768 được auto-normalized theo tài liệu |
| Matching V1 | `weighted-v1` | Không đổi | Không phụ thuộc model | Fallback deterministic |
| Matching V3 algorithm | `weighted-v3-ge2-768-semsim` | `weighted-v3-ge2-768-sts-prefix-v1` | Nội bộ | Version mới ngăn nhầm contract/vector |
| Embedding cache namespace | `gemini-embedding-cache-v2` | `gemini-embedding-cache-v3` | Nội bộ | Không đọc lại vector sinh theo request contract cũ |

Nguồn chính thức:

- Gemini deprecations: https://ai.google.dev/gemini-api/docs/deprecations
- Gemini Embedding 2 model: https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2
- Embeddings guide/task prefix/model incompatibility: https://ai.google.dev/gemini-api/docs/embeddings
- Gemini 3.6 Flash: https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash
- API errors: https://ai.google.dev/gemini-api/docs/troubleshooting
- Rate limits: https://ai.google.dev/gemini-api/docs/rate-limits

## 6. Null, empty, non-finite và timeout matrix

| Trường hợp | Hành vi mong đợi/đã test |
|---|---|
| `skills`, `experiences`, optional profile fields là `null`/`undefined`/mảng rỗng | Matching trả score hữu hạn; không throw do `.map`/`.reduce` |
| Embedding input rỗng sau normalize | Không gọi Gemini; V3 fallback V1 với reason `invalid_input` |
| Provider trả vector có `NaN`/`Infinity` | Reject vector; không ghi cache; fallback V1 |
| Vector zero norm | Cosine trả 0, không `NaN` |
| Vector khác dimension | Reject rõ ràng; không trộn/không tính similarity |
| Vector cực lớn nhưng hữu hạn | Cosine hữu hạn nhờ scaling; regression test kỳ vọng gần 1 |
| Thiếu API key embedding | Không gọi network; V3 fallback V1 |
| Thiếu API key LLM | Fail fast với mã `missing_api_key`; không gọi network |
| Timeout | Abort request; mã `timeout`; retry tối đa hữu hạn |
| HTTP 429 | Phân loại `quota_or_rate_limit`; retry hữu hạn rồi dừng |
| HTTP 5xx | Phân loại `provider_unavailable`; retry hữu hạn |
| HTTP 400 | `provider_rejected`; không retry |
| Malformed/empty model response | Không trả partial CV profile; route nhận lỗi 502 |

## 7. Dimension, similarity, cache và dữ liệu cũ

Cosine similarity chỉ hợp lệ khi hai vector cùng embedding space, cùng model/version, cùng dimension và cùng input contract. Không được coi “đều 768 chiều” là tương thích. Vector 768 chiều từ `text-embedding-004` không thể so với vector 768 chiều từ `gemini-embedding-2`.

V3 dùng 768 chiều để cân bằng chất lượng, storage, latency và vì đây là dimension được Google khuyến nghị. Với 768 chiều, Gemini Embedding 2 tự normalize vector; code vẫn tính cosine và kiểm tra norm/dimension để phòng response lỗi. Không thay đổi similarity metric hoặc semantic weight.

Cache key hiện bao gồm namespace version, model/version, output dimension, task instruction/input contract, role (`candidate`/`job`) và normalized content hash. Cache hit vì vậy không thể đi qua model/version/dimension/task/role khác. Dữ liệu cache cũ vẫn có thể giữ trong thời gian rollback nhưng không được đọc bởi namespace mới.

## 8. Fallback và ảnh hưởng nghiệp vụ cốt lõi

| Luồng | Khi Gemini lỗi | Ảnh hưởng core business |
|---|---|---|
| Matching V1/application/recommendation hiện tại | Không phụ thuộc Gemini | Apply/search/profile vẫn hoạt động |
| Matching V3 | Fallback về V1, gắn `degraded`, `requestedAlgorithmVersion`, reason; không persist fallback thành V2 | Có score deterministic, không làm sai provenance |
| Sinh job description | Trả `null`; recruiter tiếp tục nhập mô tả thủ công | Tạo/sửa job không bị chặn nếu UI giữ manual path |
| CV AI import/extract | Trả lỗi có kiểm soát, không lưu partial profile | Upload/quản lý CV thủ công cần tiếp tục là đường thay thế |
| Chatbot | Phải hiển thị unavailable/retry message, không được chặn navigation hay nghiệp vụ khác | AI chỉ advisory |
| V2 legacy endpoint | Có thể lỗi độc lập nếu model cũ shutdown | Chưa nên dùng làm đường core; cần feature gate/migration |

Không được persist V1 fallback dưới nhãn V2/V3 vì sẽ làm bẩn benchmark và khiến dữ liệu score không có provenance đáng tin cậy.

## 9. Thay đổi code và tests

- Scale vector trước dot/norm trong `cosineSimilarity`; không đổi công thức cosine, score, weights hoặc threshold.
- Thêm regression test overflow/non-finite.
- Sửa Gemini Embedding 2 request từ unsupported `taskType` sang symmetric task prefix.
- Tăng algorithm/cache namespace và đưa task instruction vào cache identity.
- Thêm test isolation theo role/model/version/dimension/task instruction.
- Thêm LLM timeout, bounded retry, status classification và fail-fast khi thiếu key.
- Chuyển API key từ query string sang request header.
- Đổi default LLM sang model stable hiện hành; không override secret/config production.
- Thêm test timeout, 400, 429, missing key, malformed response, manual fallback.
- Không đổi Prisma schema, không chạy database migration, không gọi provider thật.

## 10. Migration đề xuất và rollback

### Giai đoạn A — không cần schema/data migration (đã thực hiện trong code)

1. Deploy timeout/retry/error classification và default model mới.
2. Giữ V1 là đường production chính.
3. Cho V3 chạy shadow mode trên dữ liệu đã được phép xử lý; không ảnh hưởng ranking.
4. Ghi metrics kỹ thuật aggregate: latency, status category, fallback rate, cache hit; không log CV/prompt/API key.

Rollback: rollback application artifact; cache namespace v2/v3 cùng tồn tại và không xung đột. Không cần sửa database.

### Giai đoạn B — cần benchmark trước, chưa thực hiện

1. Xây dataset có adjudication, nhãn relevance và slice theo role/seniority/ngôn ngữ.
2. So sánh V1 với V3 bằng cùng split và metric; đặt acceptance threshold trước khi chạy.
3. Chỉ bật V3 nếu cải thiện có ý nghĩa và không làm xấu safety/fairness slices.
4. Re-embed toàn bộ record cần dùng bằng `gemini-embedding-2` và cùng task prefix. Không convert hoặc trộn vector cũ.

Rollback: feature flag về V1; giữ cache V3 trong thời gian quan sát, sau đó cleanup theo namespace.

### Giai đoạn C — thay đổi schema nếu cần lưu nhiều algorithm/version, phải xin phê duyệt

Schema hiện tại của `MatchScoreV2` có unique `(candidateId, jobId)` và `semanticScore` bắt buộc, nên không phù hợp để lưu đồng thời V2/V3 hoặc fallback có provenance đầy đủ. Nếu cần lịch sử/dual-run, đề xuất additive migration:

- thêm `algorithmVersion`, `embeddingModel`, `embeddingDimension`, `inputContractVersion`, `degraded`, `createdAt`;
- đổi uniqueness theo `(candidateId, jobId, algorithmVersion)` hoặc tạo bảng score versioned mới;
- backfill chỉ metadata có thể chứng minh; không gán model/version giả cho dữ liệu không rõ nguồn;
- migration expand/contract, backup và kiểm tra row count trước cutover.

Rollback: ứng dụng cũ tiếp tục đọc bảng/cột cũ trong giai đoạn expand; không drop/rename cột cho đến khi hết rollback window. Giai đoạn này chưa được thực hiện vì cần phê duyệt schema/data migration.

## 11. Ưu tiên tiếp theo

1. **P0:** Kiểm tra production config có còn dùng model đã shutdown; thực hiện bằng metadata/config validation không in key.
2. **P0:** Feature-gate V2 legacy để model cũ không trở thành dependency của core flow.
3. **P1:** Deploy các sửa reliability sau staging/canary; theo dõi timeout, 429, 5xx và fallback rate.
4. **P1:** Xây ground-truth dataset và benchmark V1/V3; chưa thay weights.
5. **P1:** Thêm per-user/tenant quota, circuit breaker và cost budget cho AI endpoints.
6. **P2:** Xin phê duyệt additive schema migration nếu cần lưu dual-run/versioned scores.
7. **P2:** Thêm cache retention và runbook rollback/incident cho provider outage.

## 12. Giới hạn audit

Audit là static review và test cục bộ với provider được mock. Không xác minh secret manager, deployment environment, network proxy, production logs, Gemini quota thực tế hoặc dữ liệu production. Các mục đó được ghi là rủi ro giả định, không trình bày như lỗ hổng đã xác minh.
