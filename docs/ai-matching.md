# Thiết kế AI matching ứng viên - công việc

## 1. Mục tiêu và phạm vi

Tài liệu này mô tả schema lưu kết quả matching, công thức điểm có trọng số và
luồng cập nhật/cache. Giai đoạn này chỉ chuẩn hóa dữ liệu và đặc tả; chưa triển
khai model AI hay endpoint.

Kết quả là một bản ghi cho mỗi cặp `(candidateId, jobId)`. Bản ghi không phụ
thuộc việc ứng viên đã nộp đơn hay chưa, vì matching được dùng cả cho tìm kiếm,
gợi ý và sàng lọc hồ sơ.

## 2. Schema và migration

### 2.1. `MatchScore`

`MatchScore` được định nghĩa trong
[`back-end/prisma/schema.prisma`](../back-end/prisma/schema.prisma):

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `candidateId`, `jobId` | `INT` | Khóa nghiệp vụ; unique cùng nhau |
| `applicationId` | `INT?` | Đơn ứng tuyển liên quan, nullable; unique nếu có |
| `score` | `DECIMAL(5,2)` | Điểm tổng 0-100 |
| `skillScore` | `DECIMAL(5,2)` | Thành phần kỹ năng 0-100 |
| `experienceScore` | `DECIMAL(5,2)` | Thành phần kinh nghiệm 0-100 |
| `positionScore` | `DECIMAL(5,2)` | Thành phần vị trí 0-100 |
| `locationScore` | `DECIMAL(5,2)` | Thành phần địa điểm 0-100 |
| `salaryScore` | `DECIMAL(5,2)` | Thành phần lương 0-100 |
| `employmentScore` | `DECIMAL(5,2)` | Thành phần hình thức 0-100 |
| `matchedSkills`, `missingSkills` | `JSON?` | Danh sách kỹ năng khớp/thiếu |
| `explanation` | `TEXT?` | Giải thích có thể hiển thị cho người dùng |
| `computedAt` | `DATETIME(3)` | Thời điểm tính kết quả |
| `algorithmVersion` | `VARCHAR(50)` | Phiên bản công thức/model |

Các thành phần điểm được lưu riêng để giải thích và tái hiện kết quả, không chỉ
lưu điểm tổng. Các cột điểm có `CHECK` trong database để chặn giá trị ngoài
`[0,100]`. `matchedSkills` và `missingSkills` nên có dạng:

```json
[
  { "skillId": 12, "name": "Node.js", "isRequired": true }
]
```

`applicationId` vẫn có unique index nullable: một application chỉ trỏ đến một
kết quả, nhưng một ứng viên chưa apply vẫn có thể có kết quả matching.

### 2.2. Migration

Migration [`20261026125000_redesign_match_scores`](../back-end/prisma/migrations/20261026125000_redesign_match_scores/migration.sql)
thực hiện theo thứ tự:

1. Thêm các cột mới ở trạng thái nullable.
2. Backfill `candidateId` từ `applications.candidate_id`; các bản ghi cũ nhận
   `computedAt = updatedAt`, `algorithmVersion = 'legacy-v1'` và các thành phần
   bằng `0`. Những bản ghi này phải được tính lại theo công thức mới trước khi
   hiển thị như kết quả chính thức.
3. Đổi `applicationId` thành nullable, các cột bắt buộc thành `NOT NULL`.
4. Thêm foreign key tới `candidates`, `jobs`, các CHECK 0-100 và unique index
   `(candidate_id, job_id)`.

Migration giả định dữ liệu hiện tại hợp lệ theo unique
`applications(candidate_id, job_id)` đã có trong schema. Nên chạy trên bản sao
database/staging và kiểm tra số dòng backfill trước khi production.

## 3. Công thức chấm điểm

### 3.1. Trọng số cấu hình

Phiên bản mặc định `weighted-v1` dùng:

| Thành phần | Trọng số |
|---|---:|
| Kỹ năng | 50% |
| Kinh nghiệm | 20% |
| Vị trí | 10% |
| Địa điểm | 10% |
| Lương | 5% |
| Hình thức | 5% |

Trọng số không hard-code trong bản ghi kết quả. Cấu hình runtime phải có tên,
phiên bản, tổng trọng số bằng 1 (hoặc 100%), và được ghi vào
`algorithmVersion`. Khi thay đổi trọng số, tạo version mới và tính lại; không
ghi đè âm thầm kết quả của version cũ.

Điểm tổng:

```text
score = round(
  0.50 * skillScore +
  0.20 * experienceScore +
  0.10 * positionScore +
  0.10 * locationScore +
  0.05 * salaryScore +
  0.05 * employmentScore,
  2
)
```

Mỗi thành phần được giới hạn trong `[0,100]` trước khi nhân trọng số.

### 3.2. Cách tính từng thành phần

**Kỹ năng (`skillScore`)** dùng `CandidateSkill`, `JobSkill` và `Skill`.
Chuẩn hóa tên kỹ năng (trim, không phân biệt hoa thường) và đối chiếu theo
`skillId`. Gọi `R` là tập kỹ năng bắt buộc, `O` là tập không bắt buộc:

```text
requiredRate = |candidate ∩ R| / |R|       (nếu |R| = 0 thì 1)
optionalRate = |candidate ∩ O| / |O|       (nếu |O| = 0 thì 1)
skillScore = 100 * (0.8 * requiredRate + 0.2 * optionalRate)
```

Nếu job không có kỹ năng nào, thành phần này là `100` và cần ghi rõ trong
`explanation`. `matchedSkills` chứa các kỹ năng giao nhau; `missingSkills`
chứa các kỹ năng bắt buộc không có ở ứng viên. `level` hiện có thể bổ sung vào
version sau; version đầu tiên chỉ đánh giá sự hiện diện để không suy diễn từ
chuỗi cấp độ tự do.

**Kinh nghiệm (`experienceScore`)** dùng `Candidate.yearsExperience` và yêu
cầu kinh nghiệm của job nếu schema job được bổ sung trường này. Với yêu cầu
`requiredYears > 0`:

```text
experienceScore = min(100, 100 * yearsExperience / requiredYears)
```

Khi job chưa có yêu cầu kinh nghiệm, dùng `100` nếu ứng viên có dữ liệu kinh
nghiệm, ngược lại `50` (thiếu dữ liệu không bị coi là không phù hợp hoàn toàn).
`CandidateExperience` được dùng để kiểm tra/đối soát và là nguồn thay thế khi
`yearsExperience` chưa có.

**Vị trí (`positionScore`)** so sánh `Candidate.desiredPosition` với
`Job.title` (và từ khóa chuẩn hóa trong `Job.description` nếu có bộ từ khóa).
Khớp chính xác sau chuẩn hóa là 100, khớp một phần theo token là
`100 * số token chung / số token của vị trí yêu cầu`, không khớp là 0. Nếu
ứng viên không khai báo vị trí mong muốn, dùng 50 và ghi lý do.

**Địa điểm (`locationScore`)** so sánh `Candidate.desiredLocation` (fallback
`Candidate.location`) với `Job.location`. Cùng thành phố/tỉnh là 100, khác
nhưng một phía là `Remote` là 100, khác địa điểm là 0. Nếu một giá trị thiếu,
dùng 50. Quy tắc `Remote`/`Hybrid` cần được chuẩn hóa cùng enum
`EmploymentType`, không đoán từ văn bản tùy ý.

**Lương (`salaryScore`)** so sánh `Candidate.desiredSalary` với khoảng
`Job.minSalary`-`Job.maxSalary`. Nếu nằm trong khoảng là 100; thấp hơn min:
`100 * desired / min` (giới hạn 0-100); cao hơn max là 100 vì ứng viên mong
muốn cao hơn không phải là không phù hợp, nhưng cần đánh dấu trong
`explanation`. Khi thiếu một phía của dữ liệu lương, dùng 50.

**Hình thức (`employmentScore`)** là 100 nếu
`Candidate.desiredEmploymentType` bằng `Job.employmentType`, 0 nếu khác,
và 50 nếu một trong hai chưa khai báo. `REMOTE` và `HYBRID` chỉ được coi là
khớp theo chính enum, không tự động coi là tương đương.

## 4. Luồng tính, làm mới và cache

### 4.1. Khi tính

Có ba điểm kích hoạt:

1. **Ứng viên thay đổi hồ sơ**: sau khi cập nhật các trường matching
   (`yearsExperience`, vị trí, địa điểm, lương, hình thức, kỹ năng), đánh dấu
   các cặp liên quan stale và enqueue tính lại cho job `PUBLISHED`. Không tính
   đồng bộ trong transaction cập nhật hồ sơ.
2. **Job được duyệt/publish**: khi chuyển sang `PUBLISHED`, enqueue tính cho
   ứng viên searchable phù hợp; có thể giới hạn theo batch để tránh tải lớn.
   Khi job đổi kỹ năng, lương, địa điểm, title hoặc hình thức, áp dụng cùng
   cơ chế stale/recompute.
3. **Request có cache miss**: endpoint đọc kết quả tìm bản ghi đúng cặp và
   `algorithmVersion`; nếu thiếu hoặc quá TTL thì enqueue/tính đồng bộ theo
   SLA. Trả `202` khi dùng worker bất đồng bộ, hoặc trả kết quả cũ kèm trạng
   thái stale nếu sản phẩm cho phép stale-while-revalidate.

Upsert luôn theo `(candidateId, jobId)`, cập nhật toàn bộ thành phần,
`matchedSkills`, `missingSkills`, `explanation`, `computedAt` và
`algorithmVersion` trong một transaction. Không tạo bản ghi mới theo
`applicationId`.

### 4.2. Làm mới và vô hiệu hóa

Kết quả được coi là stale khi `algorithmVersion` khác version hiện hành, quá
TTL cấu hình (đề xuất 24 giờ), hoặc nguồn Candidate/Job/Skill đã đổi sau
`computedAt`. Job queue cần deduplicate theo key `match-score:{candidateId}:`
`{jobId}:{algorithmVersion}` và retry có giới hạn; lỗi phải được log, không trả
điểm giả dạng thành công.

Khi candidate/job bị xóa, foreign key cascade xóa score. Khi một skill bị xóa,
candidate/job liên quan phải được đánh dấu stale trước hoặc trong cùng quy trình
quản trị dữ liệu.

## 5. Endpoint và quyền truy cập

Các endpoint vận hành chi tiết được mô tả ở mục 6; bảng dưới đây là hợp đồng
mở rộng cho các API recompute/đọc score chuyên biệt.

| Endpoint | Quyền | Hành vi |
|---|---|---|
| `GET /api/candidates/me/match-scores?jobId=` | Candidate đã đăng nhập, chỉ chính mình | Đọc score của cặp candidate hiện tại; không cho đổi `candidateId` |
| `GET /api/jobs/:jobId/match-scores?candidateId=` | Recruiter sở hữu job hoặc Admin | Đọc score ứng viên cho job của công ty; không lộ hồ sơ ngoài phạm vi |
| `POST /api/match-scores/compute` | Recruiter sở hữu job, Candidate cho chính mình, hoặc Admin | Yêu cầu tính/làm mới; xác thực quyền trên cả candidate và job |
| `POST /api/candidates/me/match-scores/recompute` | Candidate chính mình hoặc Admin | Làm mới các cặp của candidate; giới hạn rate/batch |
| `POST /api/jobs/:jobId/match-scores/recompute` | Recruiter sở hữu job hoặc Admin | Làm mới theo job; chỉ job hợp lệ, chống enqueue lặp |

Candidate chỉ xem được điểm và giải thích thuộc hồ sơ của mình; recruiter chỉ
xem được candidate-job thuộc job của công ty và không được sửa điểm trực tiếp.
Admin có toàn quyền vận hành, xem lỗi/version và kích hoạt recompute hàng loạt.
Các endpoint ghi nhận request nên audit `actorId`, cặp candidate-job,
`algorithmVersion`, kết quả enqueue và lý do.

## 6. Triển khai lớp 1 và lớp 2

Lớp matching quy tắc hiện được triển khai tại
`back-end/src/services/matching.service.js`. Endpoint
`GET /api/recommendations/jobs?limit=` tính top việc đã `PUBLISHED` cho
candidate hiện tại và upsert đồng thời `MatchScore` và `Recommendation`.
Endpoint recruiter là
`GET /api/recommendations/jobs/:jobId/candidates`; query
`requiredSkillIds`, `minExperience`, `location` cho phép điều chỉnh tiêu chí.
Endpoint này chỉ nhận job thuộc company của recruiter, chỉ trả candidate
searchable hoặc đã ứng tuyển, và chỉ trả email/điện thoại khi đã ứng tuyển.

Lớp LLM dùng Gemini tùy chọn qua `GEMINI_API_KEY`. Gemini chỉ được gọi để tạo
giải thích ngắn hoặc gọi các tool đọc dữ liệu thật trong `POST /api/ai/chat`.
Tool được giới hạn theo role: candidate có `searchJobs` và
`getRecommendations`, recruiter có `searchCandidates`. Timeout, retry, quota
theo user và fallback về giải thích/điểm quy tắc được xử lý trong
`back-end/src/services/llm.service.js`; thiếu API key vẫn sử dụng được lớp 1.
