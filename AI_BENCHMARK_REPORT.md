# Báo cáo benchmark AI Matching — Job Connect

Ngày báo cáo: **2026-11-04** (Asia/Saigon)  
Trạng thái: **CHƯA ĐỦ ĐIỀU KIỆN BENCHMARK**

## Kết luận

Chưa có human ground truth đạt validation. Không có Precision, Recall, NDCG hoặc latency nào được công bố
trong báo cáo này. Dataset 50 cặp cũ thiếu provenance; lần audit 2026-11-03 chỉ xác minh được 1/50 cặp;
snapshot mới nhất cũng không có record benchmark-ready. Mọi con số chất lượng V1/V2/V3 ở thời điểm này
sẽ không có giá trị nghiên cứu.

Snapshot kiểm tra mới nhất là `matching-20261104T034222115Z-2c2e9c2526`, SHA-256 database snapshot
`2c2e9c2526cf3c73171a4fb321d8615fd0d5c646c7ebb3b0f06a1b6106a40543`. Nguồn có 1 candidate và
3 job, nhưng không record nào đạt toàn bộ điều kiện benchmark-ready.

## Bảng kết quả

| Algorithm version | Embedding contract | P@1/3/5/10 | R@1/3/5/10 | NDCG@1/3/5/10 | Latency | Kết luận |
|---|---|---|---|---|---|---|
| `weighted-v1` | Không dùng embedding | N/A | N/A | N/A | N/A | Chưa chạy: thiếu dataset hợp lệ |
| `weighted-v2` | Model runtime phải được ghi khi chạy | N/A | N/A | N/A | N/A | Chưa chạy: thiếu dataset hợp lệ |
| `weighted-v3-ge2-768-sts-prefix-v1` | `gemini-embedding-2`, 768 chiều, sentence-similarity prefix | N/A | N/A | N/A | N/A | Chưa chạy: thiếu dataset hợp lệ |

`N/A` không phải 0 và không được dùng để xếp hạng thuật toán.

## Bằng chứng dataset hiện có

| Kiểm tra | Kết quả | Yêu cầu mở benchmark |
|---|---:|---:|
| Human-labeled dataset hợp lệ | 0 | 1 locked dataset |
| Candidate benchmark-ready trong snapshot gần nhất | 0 | ≥ 5; khuyến nghị 10–20 |
| Job benchmark-ready trong snapshot gần nhất | 0 | ≥ 10; khuyến nghị 20–30 |
| Pair sẵn sàng gán nhãn | 0 | ≥ 50; khuyến nghị 150–300 |
| Phủ relevance 0–3 | Chưa có nhãn | Đủ cả bốn mức |
| Quadratic weighted kappa | N/A | ≥ 0,60 |

## Hạn chế nghiên cứu

- Database development hiện quá nhỏ và không đại diện cho nhiều role/seniority/location.
- Dataset cũ không có evaluator, rubric version, timestamp hay snapshot hash đáng tin cậy.
- Chưa có blind dual annotation, adjudication hoặc inter-rater agreement.
- Chưa có locked test split; mọi tuning trước khi khóa split có nguy cơ leakage.
- V2 legacy không encode đầy đủ embedding contract trong algorithm version.
- V3 có fallback về V1; lượt degraded không được coi là kết quả V3.
- Latency embedding phụ thuộc cache, mạng, quota và region; chưa có cold/warm protocol.
- Feature synthetic (nếu dùng) chỉ chứng minh hành vi trên demo, không tự động suy rộng sang tuyển dụng thật.

## Điều kiện cập nhật báo cáo

Chỉ thay các ô `N/A` bằng artifact từ `evaluate-matching.js` khi validation metadata có trạng thái
`benchmark-ready`, hash khớp, ID/feature snapshot còn nguyên, mọi query đủ K=10 và không có lỗi/fallback ở
phiên bản đang báo cáo. Báo cáo cập nhật phải ghi dataset hash, snapshot hash, rubric version, relevance
threshold, algorithm/embedding contract, cache protocol và failure count.

Quy trình đầy đủ nằm trong `EVALUATION_DATASET_GUIDE.md`; rubric nằm trong
`MATCHING_LABELING_RUBRIC.md`.
