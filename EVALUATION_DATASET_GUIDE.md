# Hướng dẫn dataset đánh giá AI Matching — Job Connect

Ngày cập nhật: **2026-11-04** (Asia/Saigon)  
Rubric: **`matching-relevance-v1.1`**  
Exporter: **`matching-dataset-exporter-v1.1`**

## 1. Trạng thái hiện tại

Dataset 50 cặp cũ trong `back-end/data/matching-eval.csv` không phải ground truth hợp lệ: thiếu provenance;
lần audit 2026-11-03 chỉ xác minh được 1/50 cặp trong database khi đó. Snapshot gần nhất có 1 candidate, 3 job,
0 candidate benchmark-ready, 0 job benchmark-ready và 0 pair. Vì vậy **chưa được tính hoặc công bố metric
V1/V2/V3**.

Pipeline hiện dừng ở bước chuẩn bị dữ liệu. Công việc thủ công còn thiếu được liệt kê tại mục 8.

## 2. Đơn vị đánh giá và dữ liệu đủ điều kiện

Một query là một candidate; candidate pool là các job đã được gán nhãn cho chính candidate đó. Mọi thuật
toán phải chạy trên cùng database snapshot và cùng pool.

Candidate benchmark-ready phải:

- `isSearchable=true`, có ít nhất một skill, số năm kinh nghiệm và desired position/headline;
- có location, employment preference;
- có ít nhất một semantic detail từ bio, education, experience hoặc project.

Job benchmark-ready phải:

- ở trạng thái `PUBLISHED`, chưa hết hạn tại thời điểm snapshot;
- có title, description, ít nhất một skill;
- có required years experience, location và employment type.

Salary được theo dõi nhưng không bắt buộc vì matching có chính sách missing-data. ID và feature hash được
kiểm tra lại trước benchmark; record mất hoặc thay đổi sau snapshot làm dataset không hợp lệ.

Schema thực tế dùng các scalar field của `Candidate` và `Job`, cộng quan hệ `CandidateSkill`, `JobSkill`,
`CandidateEducation`, `CandidateExperience` và `CandidateProject`. V1 xếp hạng theo skill 0,50;
experience 0,20; position 0,10; location 0,10; salary 0,05; employment 0,05. V2/V3 dùng lần lượt
0,40; 0,15; 0,10; 0,05; 0,05; 0,05 và semantic 0,20. Đây là mô tả thuật toán để audit, không phải
công thức gán nhãn. Evaluator không được xem component score.

## 3. Thiết kế dataset đề xuất

Mức tối thiểu kỹ thuật là 5 candidate, 10 job, 10 job/query và 50 pair. Với đồ án, nên dùng 10–20
candidate, 20–30 job và 150–300 pair. Candidate nên trải trên frontend, backend, data, QA, design và
product; years experience nên có junior/mid/senior; location và employment type nên có cả tương thích và
xung đột.

Exporter phân tầng bằng các thuộc tính nguồn, không dùng score thuật toán:

- required skill: không giao, giao một phần, giao toàn bộ (job chỉ có optional skill thì dùng tập optional);
- experience: thiếu nhiều, gần đạt, đạt yêu cầu.

Mỗi candidate cần cả relevant và non-relevant item. Toàn dataset phải phủ đủ relevance 0, 1, 2, 3 và
ít nhất 10 job khác nhau. Nếu database thật quá ít, tạo database evaluation riêng với feature synthetic;
không tự sinh relevance label.

## 4. Ẩn danh và provenance

Chạy từ `back-end`:

```powershell
npm run export:matching-labels
```

Mỗi lần chạy tạo một thư mục bất biến trong `data/evaluation-snapshots/<snapshot_id>/`:

- `labeling-pairs.csv`: file duy nhất gửi evaluator; dùng HMAC pseudonym, không có database ID;
- `snapshot-summary.json`: số lượng, completeness, sampling strata, rubric/exporter version và snapshot hash;
- `private-manifest.json`: ánh xạ ID, salt và feature hash (không lưu raw profile); phải giữ private.

`back-end/data/matching-eval-template.csv` chỉ là template cấu trúc. Khi gán nhãn thật phải dùng file
do exporter tạo, không tự điền database ID vào template.

Exporter không đưa bio, tên, email, điện thoại, link, tên công ty/trường hay project text vào candidate
profile. Email, điện thoại, URL trong job text được thay bằng token; location có dấu hiệu địa chỉ chính xác
được làm thô. Dù có bộ lọc tự động, data owner vẫn phải rà soát `labeling-pairs.csv` trước khi phân phối.

Provenance bắt buộc gồm snapshot ID/hash, pair ID, rubric/exporter version, hai evaluator pseudonym độc lập,
timestamp ISO-8601 có timezone và adjudicator/timestamp khi bất đồng. Không dùng email/họ tên làm evaluator ID.

## 5. Gán nhãn thủ công

Dùng `MATCHING_LABELING_RUBRIC.md`. Hai evaluator làm độc lập và bị blind với score, rank, explanation,
matched/missing skills của mọi model.

- `0`: không phù hợp hoặc vi phạm hard constraint rõ ràng.
- `1`: phù hợp yếu, có tín hiệu thật nhưng thiếu nhiều must-have.
- `2`: phù hợp, đáp ứng phần lớn must-have, không có hard conflict.
- `3`: rất phù hợp, gần như đủ must-have và có thể shortlist trực tiếp.

Nếu hai nhãn giống nhau, `final_relevance` bằng nhãn đồng thuận. Nếu khác nhau, adjudicator thứ ba quyết
định, ghi timestamp và notes; không lấy trung bình. Output thuật toán tuyệt đối không được dùng để tạo,
sửa hoặc adjudicate ground truth.

## 6. Validation và cổng benchmark

```powershell
node scripts/prepare-matching-benchmark.js `
  --labels data/evaluation-snapshots/<snapshot_id>/labeling-pairs.csv `
  --manifest data/evaluation-snapshots/<snapshot_id>/private-manifest.json `
  --output data/matching-benchmark.csv
```

Script luôn tạo `matching-benchmark.csv.validation.json`. Chỉ khi không có lỗi, script mới tạo benchmark
CSV và metadata có dataset SHA-256. Cổng mặc định kiểm tra:

- snapshot/pseudonym/profile hash không bị sửa; ID còn tồn tại và feature hash không đổi;
- đủ hai evaluator, timestamp hợp lệ, adjudication đúng quy trình;
- ít nhất 5 query, 10 job/query, 10 job khác nhau;
- mỗi query có relevant và non-relevant; toàn bộ bốn mức 0–3 xuất hiện;
- quadratic weighted kappa trước adjudication ≥ 0,60;
- relevance threshold được khóa ở `>=1` trong metadata.

Nếu kappa thấp, hiệu chỉnh rubric và gán nhãn lại độc lập. Không loại pair hoặc sửa nhãn sau khi xem model
score. Nên khóa test split theo candidate trước khi tuning weights.

## 7. Benchmark và version thuật toán

Chỉ chạy sau khi validation trả `benchmark-ready`:

```powershell
# V1 và V2 legacy
node scripts/evaluate-matching.js --input data/matching-benchmark.csv

# V1 và embedding migration V3; không gọi model V2 đã lỗi thời
node scripts/evaluate-matching.js --input data/matching-benchmark.csv --skip-v2 --include-v3
```

Script tính macro Precision@1/3/5/10, Recall@1/3/5/10 và NDCG@1/3/5/10 theo candidate, cùng latency
mean/P50/P95/min/max. Threshold runtime phải khớp metadata. Nếu bất kỳ V2/V3 pair nào lỗi, hoặc V3 fallback
về V1, metric của phiên bản đó không được tính trên subset còn lại.

`weighted-v1`, `weighted-v2` và `weighted-v3-ge2-768-sts-prefix-v1` là ba algorithm version khác nhau.
V2 phải ghi thêm embedding model thực tế. V3 ghi model version, task instruction, output dimension và observed
algorithm version. Thay model, dimension, task instruction, normalization hoặc weights bắt buộc tạo version
mới và chạy lại trên cùng locked test set.

Latency embedding hiện chỉ có tính mô tả vì cache state chưa được kiểm soát. Báo cáo chính thức cần tách
cold/warm cache, cố định concurrency/region/quota, warm-up và số vòng đo.

## 8. Công việc thủ công còn thiếu

1. Bổ sung dữ liệu nguồn để đạt tối thiểu, hoặc tạo database evaluation synthetic độc lập.
2. Chạy exporter và data owner rà soát thủ công file ẩn danh.
3. Chỉ định hai evaluator độc lập; gán nhãn toàn bộ pair theo rubric v1.1.
4. Chỉ định adjudicator thứ ba cho các bất đồng.
5. Chạy validation; xử lý lỗi coverage/agreement mà không xem model output.
6. Khóa benchmark CSV, metadata/hash và test candidate split.
7. Sau đó mới chạy V1/V2 hoặc V1/V3 và điền `AI_BENCHMARK_REPORT.md` từ artifact máy sinh.

