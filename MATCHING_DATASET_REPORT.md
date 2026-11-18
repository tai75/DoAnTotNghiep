# Báo cáo xây dựng dataset đánh giá AI Matching

Tài liệu có thể dùng làm nền cho Chương 4. Audit được thực hiện ngày **2026-11-04** trên database
development đang cấu hình; không có dữ liệu production nào bị sửa.

## 1. Mục tiêu và nguyên tắc

Dataset đánh giá là tập candidate-job pairs được hai người gán graded relevance 0–3 độc lập. Output
V1/V2/V3 không được đưa vào file cho evaluator, không dùng làm nhãn và không dùng để adjudicate.
Sampling chỉ dùng thuộc tính nguồn để tạo độ phủ, không dùng match score.

## 2. Trường dữ liệu và điều kiện đủ

Candidate tối thiểu để matching có ý nghĩa: có ít nhất một skill, `yearsExperience`, và
`desiredPosition` hoặc headline. Candidate benchmark-ready còn phải searchable, có location,
employment preference và ít nhất một semantic detail từ bio/education/experience/project. Salary là
khuyến nghị nhưng không bắt buộc vì thuật toán có missing-data policy.

Job tối thiểu: đang `PUBLISHED` và chưa hết hạn, có title, description và ít nhất một skill. Job
benchmark-ready còn cần `requiredYearsExperience`, location và employment type. Salary range được
theo dõi nhưng không bắt buộc.

## 3. Kết quả audit dữ liệu hiện tại

Nguồn máy đọc:
`back-end/data/evaluation-snapshots/matching-20261104T034222115Z-2c2e9c2526/snapshot-summary.json`.

| Thuộc tính | Candidate | Job |
|---|---:|---:|
| Tổng số | 1 | 3 |
| Searchable / active published | 1 | 3 |
| Có skills | 0 | 1 |
| Có years/required years | 0 | 0 |
| Có position/title | 1 | 1 |
| Có location | 1 | 3 |
| Có salary | 0 | 1 |
| Có employment type | 0 | 3 |
| Minimum matchable | 0 | 1 |
| Benchmark-ready | 0 | 0 |

Kết luận: **0 candidate, 0 job và 0 pair benchmark-ready**. Database hiện tại không đủ để gán nhãn
hoặc tính Precision@K, Recall@K, NDCG@K và latency. Không có kết quả thực nghiệm nào được tạo.

## 4. Thiết kế sampling

Exporter lấy tối đa 20 job/candidate và phân tầng cân bằng theo tổ hợp các nhóm quan sát được:

- Không giao required skill.
- Giao một phần required skills.
- Giao toàn bộ required skills.
- Kinh nghiệm đạt yêu cầu, gần yêu cầu (ít nhất 50%) hoặc có khoảng cách lớn.

Phân tầng chỉ dùng để đảm bảo có cặp đa dạng, không phải nhãn relevance. Trong từng tầng, pair được
sắp xếp xác định bằng hash snapshot/candidate/job, không dùng output matching. Ngưỡng tối thiểu trước
gán nhãn là 5 candidate, 10 job và 50 pair; khuyến nghị cho đồ án là 10–20 candidate, 20–30 job và
ít nhất 150–300 pair.

## 5. Ẩn danh và provenance

File evaluator chỉ chứa pseudonym HMAC, structured candidate profile không có user/name/email/phone,
không có company/school/link của candidate, và job không có company identity. Private manifest lưu
ánh xạ ID, feature hash, database snapshot SHA-256, exporter/rubric version và sampling stratum.

Pipeline từ chối benchmark nếu ID không tồn tại, feature đã đổi sau snapshot, profile ẩn danh bị sửa,
rubric/timestamp thiếu, hai evaluator trùng nhau hoặc bất đồng chưa adjudicate.

## 6. Điều kiện tính metric

`evaluate-matching.js` chỉ chạy khi có metadata `benchmark-ready`, dataset SHA-256 đúng, feature hash
khớp snapshot, mỗi candidate có ít nhất K items và có cả relevant lẫn non-relevant. Mặc định K lớn
nhất là 10. Precision@K, Recall@K, NDCG@K được macro-average theo candidate; latency chỉ được ghi
trong cùng lần benchmark hợp lệ.

## 7. Phương án dữ liệu demo độc lập

Tạo database riêng, ví dụ `job_connect_eval_demo`; không seed vào production. Nên xây dựng:

- 10–20 candidate synthetic có skill taxonomy nhất quán, 0–10 năm kinh nghiệm, nhiều role/location/
  employment type và cả hồ sơ có missing optional fields.
- 20–30 job synthetic thuộc frontend/backend/data/QA/design/product, có required/optional skills,
  experience ranges và hard constraints đa dạng.
- Gắn `source=synthetic-demo` trong tài liệu dataset và giữ seed/version cố định.

Dữ liệu synthetic chỉ tạo candidate/job features, **không tạo relevance labels**. Hai evaluator vẫn
phải gán nhãn độc lập, được blind với model score. Nên dành một phần candidate làm test set khóa;
không điều chỉnh trọng số trên test set.

## 8. Lệnh vận hành

```powershell
cd back-end
npm run export:matching-labels

node scripts/prepare-matching-benchmark.js `
  --labels data/evaluation-snapshots/<snapshot>/labeling-pairs.csv `
  --manifest data/evaluation-snapshots/<snapshot>/private-manifest.json `
  --output data/matching-benchmark.csv

node scripts/evaluate-matching.js --input data/matching-benchmark.csv
```

Rubric: `MATCHING_LABELING_RUBRIC.md`. `prepare` luôn sinh validation report; chỉ sinh benchmark CSV
và metadata khi tất cả điều kiện đạt.
