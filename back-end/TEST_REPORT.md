# Job Connect test report

Ngày chạy: 2026-11-03  
Phạm vi: backend Node.js/Express/Prisma, không sử dụng hoặc thay đổi dữ liệu production.

## Kết quả thực tế

| Lệnh | Kết quả |
|---|---:|
| `npm run test:unit` | 3 files, 14 passed, 0 failed |
| `npm run test:integration` | 4 files, 30 passed, 0 failed |
| `npm test` | 7 files, 44 passed, 0 failed |
| `npm run test:coverage` | 7 files, 44 passed, 0 failed |

Coverage V8 thực tế của toàn bộ `src/**/*.js` (trừ entrypoint server và Prisma adapter):

| Metric | Covered | Total | Tỷ lệ |
|---|---:|---:|---:|
| Statements | 664 | 1806 | 36.76% |
| Branches | 271 | 1077 | 25.16% |
| Functions | 95 | 342 | 27.77% |
| Lines | 628 | 1539 | 40.80% |

Báo cáo HTML được sinh tại `coverage/index.html`; số liệu máy đọc nằm tại `coverage/coverage-summary.json`. Coverage tổng còn thấp vì nhiều endpoint CRUD/AI phụ chưa nằm trong phạm vi ưu tiên; không thêm test giả để đẩy tỷ lệ.

## Phân loại test

### Integration (Supertest)

`tests/integration/api-workflows.integration.test.js` chạy Express app, middleware, validation, JWT, bcrypt, cookie và router thật. Prisma được thay bằng adapter bộ nhớ chỉ trong `NODE_ENV=test`.

- Register candidate, login, refresh-token rotation, logout và access-token invalidation.
- RBAC chéo cho cả CANDIDATE, RECRUITER và ADMIN.
- Ứng tuyển thành công, chặn ứng tuyển trùng, rút đơn đúng chủ sở hữu.
- Recruiter được cập nhật application thuộc công ty mình, đồng thời bị chặn khi sửa job/application của công ty khác.
- Admin moderation tạo audit log.
- Recruiter sở hữu application mở conversation; participant gửi message đã loại HTML; candidate ngoài cuộc bị chặn.
- Upload PDF hợp lệ theo MIME/chữ ký; file giả bị từ chối; file test chỉ ghi vào thư mục tạm và được dọn sau suite.

`tests/integration/job-alert-worker.integration.test.js` chạy worker thật với Prisma/SMTP giả lập:

- Lọc job theo alert.
- Tạo notification, gửi đúng một email mock và cập nhật `lastSentAt`.

`tests/routes.test.js` và `tests/security.test.js` được xếp vào nhóm integration/regression vì chúng khởi tạo Express/Supertest cho các nhánh HTTP, bên cạnh một số assertion helper/schema.

### Unit

- `tests/matching.service.test.js`: matching weighted V1, giải thích rule, trọng số V2 và cosine similarity.
- `tests/unit/matching-v2-cache.test.js`: V2 với Gemini `fetch` mock; cache hit không gọi lại external service và nội dung job thay đổi tạo content hash/cache entry mới.
- `tests/jobAlert.service.test.js`: rule matching, frequency/due calculation.

Các regression nói trên bao phủ schema, upload signature, completeness, rate limit, JWT allowlist, refresh replay/rotation, CORS, cookie flags, safe error disclosure và dữ liệu recruiter-only.

## Cô lập external services và database

- Không dùng MySQL thật. `src/config/prisma.js` chỉ nhận `globalThis.__JOB_CONNECT_TEST_PRISMA__` khi `NODE_ENV=test`; nếu adapter chưa được cấu hình, truy cập Prisma ném lỗi thay vì fallback sang database.
- SMTP được chuyển qua callback test trong `src/services/mail.service.js`; không có email thật được gửi.
- Gemini embedding dùng `fetch` mock ổn định, không dùng API key thật và không có network request.
- `UPLOADS_DIRECTORY` cho phép integration test dùng thư mục tạm thay vì `back-end/uploads`.
- Các giá trị JWT/database trong test là giá trị giả, không đọc hay ghi `.env`.

## Vitest `spawn EPERM`

Đã tái hiện trên Windows sandbox ở bước load config với stack trace `externalize-deps -> spawn EPERM`. Chỉ đổi pool sang threads chưa đủ vì Vite vẫn spawn process khi bundle config.

Cách khắc phục đã kiểm chứng:

- `vitest.config.js`: `pool: 'threads'`, một worker và tắt file parallelism để suite có trạng thái mock xác định.
- Tất cả npm scripts dùng `--configLoader native`, tránh bước bundle config gây spawn.

Sau thay đổi, cả `npm test` và `npm run test:coverage` chạy thành công ngay trong sandbox, không cần quyền chạy ngoài sandbox.

## Hạn chế còn lại

- Integration dùng Prisma mock có state, vì vậy kiểm tra logic router/transaction boundary nhưng không kiểm chứng constraint/index/migration thực tế của MySQL. Nên bổ sung một pipeline riêng dùng database disposable khi CI có Docker/MySQL test.
- Chưa bao phủ toàn bộ CRUD candidate/company/recruiter, password reset, recommendation endpoints và các nhánh lỗi SMTP/Gemini.
- `npm install` báo 10 dependency advisories (4 moderate, 6 high). Chưa tự động chạy `npm audit fix` vì có thể thay đổi dependency/runtime ngoài phạm vi xây dựng test.
