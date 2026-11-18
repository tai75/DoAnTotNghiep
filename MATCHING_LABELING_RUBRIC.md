# Rubric gán nhãn AI Matching — `matching-relevance-v1.1`

## Nguyên tắc

Evaluator chỉ xem hồ sơ/công việc đã ẩn danh trong `labeling-pairs.csv`. Không được xem score,
rank, matched/missing list hoặc explanation của V1/V2/V3. Nhãn phản ánh mức phù hợp tuyển dụng dựa
trên dữ liệu hiện diện; không suy đoán kỹ năng hoặc kinh nghiệm không được cung cấp.

Đánh giá theo thứ tự:

1. Mức liên quan của vị trí mong muốn và công việc.
2. Kỹ năng bắt buộc, kỹ năng tùy chọn và kỹ năng tương đương có thể giải thích được.
3. Kinh nghiệm so với yêu cầu.
4. Location, employment type và salary nếu cả hai phía có dữ liệu.
5. Bằng chứng bổ sung từ chức danh kinh nghiệm, ngành học và công nghệ dự án.

Thiếu dữ liệu không tự động đồng nghĩa không phù hợp. Ghi rõ `insufficient evidence` trong notes và
chỉ chấm theo bằng chứng quan sát được. Xung đột hard constraint rõ ràng có ưu tiên cao hơn điểm mạnh
ở tiêu chí khác.

`Hard constraint` chỉ là điều kiện được ghi rõ là bắt buộc trong job/profile (ví dụ hình thức làm việc,
địa điểm không thể thay đổi, giấy phép/chứng chỉ hoặc kỹ năng cốt lõi). Không tự suy diễn giới tính, tuổi,
trường học, công ty cũ hoặc đặc điểm được bảo vệ thành điều kiện tuyển dụng.

## Quy tắc quyết định nhất quán

| Tình huống quan sát được | Mức tối đa thông thường |
|---|---:|
| Xung đột một hard constraint rõ ràng | 0 |
| Không có tín hiệu liên quan thật giữa role/domain/skills | 0 |
| Có tín hiệu chuyển giao nhưng thiếu phần lớn kỹ năng bắt buộc | 1 |
| Đáp ứng phần lớn must-have, không có hard conflict, còn khoảng trống có thể xác minh/đào tạo | 2 |
| Đáp ứng gần như toàn bộ must-have, role gần, kinh nghiệm đạt và có thể shortlist trực tiếp | 3 |

Bảng này là điểm neo, không phải phép cộng tự động. Evaluator phải ghi notes khi dùng skill tương đương,
khi thiếu dữ liệu ảnh hưởng quyết định, hoặc khi nhãn nằm sát ranh giới hai mức.

## Graded relevance 0–3

### 3 — Rất phù hợp

- Vị trí mục tiêu trùng hoặc rất gần job title/domain.
- Đáp ứng toàn bộ hoặc gần như toàn bộ required skills; skill tương đương phải được giải thích.
- Kinh nghiệm đạt yêu cầu hoặc chênh lệch không đáng kể nhưng có bằng chứng bù đắp rõ.
- Không có xung đột location/employment/salary quan sát được.
- Có thể shortlist trực tiếp dựa trên hồ sơ hiện có.

### 2 — Phù hợp

- Vai trò cùng nhóm nghề hoặc có hướng chuyển đổi hợp lý.
- Đáp ứng phần lớn required skills, có thể thiếu một số kỹ năng có khả năng đào tạo.
- Kinh nghiệm gần yêu cầu; có bằng chứng kỹ thuật/học vấn/dự án hỗ trợ.
- Không có hard constraint nghiêm trọng.
- Nên cân nhắc phỏng vấn nhưng cần xác minh một số khoảng trống.

### 1 — Phù hợp yếu

- Có một phần kỹ năng chuyển giao hoặc kinh nghiệm liên quan nhưng còn nhiều khoảng trống.
- Thiếu nhiều required skills, kinh nghiệm thấp đáng kể, hoặc mục tiêu nghề nghiệp chỉ liên quan xa.
- Có thể xem xét cho junior/reskilling nhưng chưa đủ bằng chứng để shortlist cho job hiện tại.
- Không dùng mức 1 chỉ vì hồ sơ thiếu dữ liệu; phải có ít nhất một tín hiệu liên quan thật.

### 0 — Không phù hợp

- Vai trò/domain không liên quan và không có kỹ năng chuyển giao đáng kể; hoặc
- Không đáp ứng required skills cốt lõi; hoặc
- Có hard conflict rõ ràng về hình thức làm việc/location mà job không cho phép; hoặc
- Hồ sơ cung cấp bằng chứng rõ rằng candidate không thể đáp ứng yêu cầu hiện tại.

## Quy trình hai evaluator

1. Hai evaluator làm độc lập và không xem nhãn của nhau.
2. Mỗi người điền ID pseudonym, relevance 0–3, ISO-8601 timestamp và notes ngắn cho trường hợp khó.
3. Nếu hai nhãn giống nhau, `final_relevance` phải bằng nhãn đồng thuận.
4. Nếu khác nhau, adjudicator đọc hai lập luận, ghi ID/timestamp và quyết định final label; không lấy
   trung bình tự động.
5. Không sửa `snapshot_id`, `pair_id`, pseudonym, profile JSON hoặc `rubric_version`.

Timestamp dùng ISO-8601 có timezone, ví dụ `2026-11-04T10:30:00+07:00`. ID evaluator/adjudicator là
pseudonym nội bộ, không dùng email, số điện thoại hay họ tên trong file gán nhãn.

Pipeline báo cáo quadratic weighted Cohen's kappa trước adjudication. Ngưỡng mặc định để mở benchmark
là 0,60 và dataset phải phủ đủ cả bốn mức 0–3; nếu không đạt, nhóm evaluator phải hiệu chỉnh rubric,
rà soát độc lập và gán nhãn lại — không sửa nhãn để “đuổi theo” score của thuật toán.
