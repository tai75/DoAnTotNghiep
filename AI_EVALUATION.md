# Đánh giá AI Matching V1/V2 — Job Connect

> Cập nhật reliability ngày 2026-11-04: lỗi `NaN` do tràn số trong cosine similarity đã được tái hiện bằng regression test và sửa mà không đổi weights hay ý nghĩa score. Kết luận benchmark bên dưới vẫn giữ nguyên: dataset hiện tại chưa đủ ground truth và chưa chứng minh V2 tốt hơn V1. Xem `AI_RELIABILITY_REPORT.md` để biết model compatibility, fallback và kế hoạch migration.

Ngày audit: **2026-11-03** (Asia/Saigon)

## 1. Kết luận điều hành

Chưa thể công bố so sánh chất lượng V1/V2 trên dữ liệu hiện có. `back-end/data/matching-eval.csv`
có 50 cặp, nhưng không có provenance nhãn (`annotator`, `labeled_at`, phiên bản guideline), và
49/50 cặp không tham chiếu được candidate/job trong database đang cấu hình. Vì vậy các giá trị
`label` hiện tại **không được coi là ground truth đã kiểm chứng**. Lần chạy ngày 2026-11-03 xuất
artifact với trạng thái `invalid-dataset`, không xuất metric giả.

Ngoài vấn đề dữ liệu, V2 hiện có hai blocker:

1. Model mặc định `text-embedding-004` đã bị Google ngừng phục vụ ngày 2026-01-14; model thay thế
   hiện hành là `gemini-embedding-2`.
2. `calculateWeightedV2()` reduce trên toàn bộ object V1, gồm cả `matchedSkills` và
   `missingSkills`. Trong JavaScript, `0 * Number(arrayOfObjects)` có thể là `NaN`, làm điểm tổng
   V2 thành `NaN` khi một trong các danh sách có phần tử.

Do chưa có bằng chứng thực nghiệm hợp lệ, báo cáo **không đề xuất và không thay đổi trọng số**.

## 2. Implementation hiện tại

### 2.1. V1 (`weighted-v1`)

Điểm tổng:

```text
0.50 skill + 0.20 experience + 0.10 position + 0.10 location
+ 0.05 salary + 0.05 employment
```

Mỗi thành phần được chặn trong `[0, 100]`, điểm cuối làm tròn hai chữ số. V1 được dùng trong
endpoint match, application và recommendation; recommendation production hiện không dùng V2.

| Thành phần | Cách tính thực tế | Khi thiếu dữ liệu |
|---|---|---|
| Skill | 80% tỉ lệ skill bắt buộc + 20% tỉ lệ skill tùy chọn | Job không có skill = 100. Không có optional skill thì `optionalRate=1`, nên candidate thiếu toàn bộ required vẫn nhận 20 điểm skill. |
| Experience | `min(100, candidateYears / requiredYears * 100)` | Job có yêu cầu nhưng candidate thiếu = 0; job không yêu cầu: candidate có years = 100, thiếu = 50. |
| Position | Exact = 100; nếu không exact, tỉ lệ token của desired position có trong title | Candidate thiếu desired position = 50; job title rỗng = 0. |
| Location | Exact/substring hoặc có chuỗi `remote` = 100, khác = 0 | Một phía thiếu = 50. |
| Salary | Nếu desired < min: `desired/min*100`; các trường hợp còn lại = 100 | Candidate thiếu hoặc job thiếu cả min/max = 50. `maxSalary` được đọc nhưng không tham gia quyết định. |
| Employment | Enum bằng nhau = 100, khác = 0 | Một phía thiếu = 50. |

Hai quy tắc cần được product owner xác nhận trước khi sửa: salary hiện coi yêu cầu lương vượt
`maxSalary` là 100 nhưng desired thấp hơn `minSalary` lại bị trừ điểm; skill required-only luôn có
baseline 20. Đây là hành vi đang chạy, không phải thay đổi được thực hiện trong audit này.

### 2.2. Chuẩn hóa skill và text

- Skill được `trim()` và lowercase, nhưng ưu tiên so sánh `skill.id`; tên chuẩn hóa chỉ là fallback
  khi không có ID.
- Không có Unicode normalization (NFC/NFKC), alias/synonym (`JS` ↔ `JavaScript`), stemming,
  mapping version hoặc taxonomy. `CandidateSkill.level` không được dùng.
- Vì `Skill.name` unique trong database, ID giúp exact matching ổn định trong cùng database; dữ liệu
  import từ nguồn khác vẫn có nguy cơ tách alias thành skill khác.
- Token position chỉ là lexical overlap, không hiểu chức danh tương đương.

### 2.3. V2 (`weighted-v2`)

V2 giữ sáu component của V1 và thêm cosine similarity:

```text
0.40 skill + 0.15 experience + 0.10 position + 0.05 location
+ 0.05 salary + 0.05 employment + 0.20 semantic
```

Candidate text ghép headline, bio, desired position, skills, education, experience và project. Job
text ghép title, description, location và skills. Hai text được embed riêng, cosine bị chặn về
`[0, 1]`, rồi nhân 100.

Model mặc định trong code là `text-embedding-004`, gọi REST `v1beta/models/...:embedContent`.
Không truyền `task_type`, `output_dimensionality` hay một model revision bất biến. Theo tài liệu
Google hiện tại, `text-embedding-004` đã shutdown; `gemini-embedding-2` là stable embedding model,
input tối đa 8.192 token và output 128–3.072 chiều. Việc migrate model là thay đổi thuật toán và
phải tạo algorithm version mới, re-embed, rồi đánh giá lại; audit này không tự đổi model.

Nguồn: [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations),
[Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings).

### 2.4. Gemini lỗi và fallback

- Sinh giải thích V1: tối đa hai lần gọi; timeout theo `LLM_TIMEOUT_MS` (mặc định 8 giây). Thiếu key,
  vượt quota nội bộ hoặc lỗi API trả `null`, caller fallback sang `buildRuleExplanation()`.
- Giới hạn nội bộ là 20 request/giờ cho mỗi `(feature, user)` trong memory; restart process làm mất
  counter và nhiều instance không chia sẻ quota.
- Embedding V2 không đi qua wrapper trên: không timeout, retry, exponential backoff, rate limit hay
  circuit breaker. Bất kỳ lỗi key/network/HTTP/payload nào làm endpoint V2 lỗi; **không fallback V1**.
- Fallback giải thích không làm thay đổi điểm. Không có trường dữ liệu cho biết explanation đến từ
  LLM hay rule, nên audit nguồn giải thích còn hạn chế.

Gemini quota thực được áp dụng theo project, không theo API key, và thay đổi theo model/tier; các
chiều thường là RPM, TPM và RPD. Cần ghi quota hiển thị trong AI Studio tại thời điểm chạy thay vì
hard-code một con số chung. Lỗi 429/5xx nên dùng exponential backoff.

Nguồn: [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits),
[Gemini API errors](https://ai.google.dev/gemini-api/docs/api-errors).

### 2.5. Cache và invalidation

**Embedding cache:** key là SHA-256 của `model + "\n" + text`. Khi nội dung hoặc tên model đổi,
hash đổi và cache miss tự nhiên; đây là content-addressed invalidation đúng hướng. Tuy nhiên chưa có
TTL/GC, dimension/checksum validation, tenant scope hoặc cơ chế xóa vector mồ côi.

**Match score cache:** `MatchScore` và `MatchScoreV2` unique theo `(candidateId, jobId)` và lưu
`computedAt`, `algorithmVersion`. Nhưng endpoint không dùng chúng như read cache: request luôn tính
lại rồi upsert. Không có kiểm tra `Candidate.updatedAt`, `Job.updatedAt`, thay đổi relation skill,
TTL hoặc version hiện hành. V1 còn tái dùng `existing.explanation` vô thời hạn dù score vừa tính lại,
nên explanation có thể stale. Chuỗi `weighted-v2` cũng không encode model và weights; đổi env vẫn
ghi cùng version, làm giảm khả năng tái lập.

### 2.6. Khả năng giải thích

V1 lưu component scores, matched/missing required skills và một câu explanation. Đây là nền tảng
explainability tốt hơn chỉ lưu tổng điểm, nhưng câu rule-based mới nói về skill; không giải thích
experience/location/salary/employment, missing-data baseline hay contribution theo trọng số. Câu LLM
chỉ nhận total score và skill lists, nên cũng không thể giải thích trung thực các component khác.

V2 lưu semantic score nhưng không lưu explanation, embedding model revision, hash hai input, vector
dimension, weights snapshot hoặc contribution từng component. Vì vậy chưa thể truy nguyên đầy đủ
“vì sao điểm này xuất hiện” sau khi cấu hình thay đổi.

## 3. Thiết kế đánh giá khách quan

Đơn vị query là một candidate; candidate pool là cùng một tập job đã được chấm nhãn cho candidate
đó. V1 và V2 bắt buộc chạy trên đúng snapshot candidate/job và cùng pool. Không dùng application
status hoặc điểm model để tự sinh nhãn.

### 3.1. Nhãn thủ công

Template: `back-end/data/matching-eval-template.csv`.

Thang đề xuất:

- `0`: không phù hợp hoặc vi phạm must-have rõ ràng.
- `1`: phù hợp yếu; còn thiếu nhiều điều kiện nhưng có thể cân nhắc.
- `2`: phù hợp; đáp ứng phần lớn yêu cầu.
- `3`: rất phù hợp; đáp ứng must-have và mục tiêu nghề nghiệp chính.

Mỗi cặp nên được hai người đánh giá độc lập, ẩn score V1/V2; bất đồng được adjudicator chốt. Ghi
`annotator`, `annotator_2`, `relevance_2`, `adjudicator`, thời điểm và `guidelines_version`. Freeze
database snapshot hoặc export feature snapshot cùng dataset. Với binary Precision/Recall, mặc định
`relevance >= 1` là relevant; threshold phải được chốt trước khi xem kết quả.

Dataset phải có nhiều query và đủ candidate pool cho K lớn nhất. Nên báo cáo cả số relevant/query,
query không có relevant và inter-annotator agreement. Chia train/tuning/test theo candidate; chỉ dùng
train/tuning để thử trọng số, giữ test khóa đến lần đánh giá cuối.

### 3.2. Metric

- `Precision@K = relevant trong top K / K`.
- `Recall@K = relevant trong top K / tổng relevant trong pool của query`.
- `NDCG@K` dùng gain `2^relevance - 1`, giữ được thông tin graded relevance 0–3.
- Aggregate macro theo candidate để candidate có nhiều cặp không lấn át candidate khác.
- Latency đo riêng từng pair bằng monotonic clock, xuất mean/P50/P95/min/max. V2 latency hiện trộn
  cache hit và cache miss, vì vậy chỉ có tính mô tả; benchmark chính thức phải tách cold-cache và
  warm-cache, chạy nhiều vòng, cố định concurrency/region/quota.

Script còn xuất rank/score/latency từng cặp để audit tie và lỗi. Tie được phá ổn định theo `job_id`.
Nếu V2 lỗi ở bất kỳ cặp nào, script không tính metric V2 trên subset thành công để tránh so sánh lệch
pool.

## 4. Cách chạy và artifact

Kiểm tra dataset đã xác minh (mặc định chặn nếu thiếu provenance):

```powershell
cd back-end
npm run evaluate:matching
```

Chỉ để diagnostic dataset cũ, kết quả luôn mang cờ provisional:

```powershell
npm run evaluate:matching:provisional
```

Artifact ổn định:

- `back-end/data/evaluation-results/matching-evaluation.json`: trạng thái, metric, per-query,
  latency, dataset hash, database snapshot hash, model và weights.
- `back-end/data/evaluation-results/matching-evaluation-pairs.csv`: label, score/rank/latency từng
  version và lỗi V2 từng cặp.

Kết quả lần chạy hiện tại:

| Trạng thái | Rows | Provenance verified | Cặp không tồn tại | V1 metrics | V2 metrics |
|---|---:|---:|---:|---|---|
| `invalid-dataset` | 50 | Không | 49 | Không tính | Không tính |

Đây là validation result, không phải kết quả chất lượng model.

## 5. Điều kiện tái lập

Trước mỗi thí nghiệm chính thức phải lưu:

1. Git commit và trạng thái worktree; Node/npm lockfile và Prisma version.
2. SHA-256 dataset, guideline version, relevance threshold, K, candidate pool construction.
3. Database/feature snapshot hash (script đã xuất), timezone và thời điểm chạy.
4. Exact embedding model/revision, task type, output dimension, endpoint/API version, project tier và
   quota tại thời điểm chạy; không lưu API key.
5. V1/V2 algorithm version và weights snapshot (script đã xuất).
6. Cache condition (cold/warm), số vòng warm-up/measurement, concurrency, host/region và network.
7. Số lỗi/429/timeout/retry. Không thay lỗi V2 bằng score V1 trong cùng cột V2.

Chỉ cân nhắc đổi weights sau khi có test set đã xác minh, confidence interval hoặc paired bootstrap,
và cải thiện metric mục tiêu không phải do leakage hay candidate-pool mismatch. Mọi thay đổi weights,
model, normalization hoặc fallback phải tạo version mới và được ghi rõ trong changelog.
