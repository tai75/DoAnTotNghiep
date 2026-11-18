# Job Connect — Full Project Audit & Development Roadmap

Ngày audit: 2026-11-04  
Branch/HEAD: `dev2` / `0989caf`  
Phạm vi: source, cấu hình, Prisma/migration, tests và tài liệu trong worktree hiện tại. Không ghi database, không gọi Gemini thật, không sửa source và không chạy authenticated E2E có khả năng ghi development data.

## 1. Executive Summary

Job Connect đã có kiến trúc full-stack tương đối đầy đủ cho ba role: 95 REST endpoint, 35 Prisma model, JWT access token + rotating HttpOnly refresh token, matching V1, CV/job workflows, recruiter pipeline, admin moderation, messaging, notification và job-alert worker. Backend regression hiện tại đạt **95/95 tests**; frontend lint đạt exit 0; production build và các E2E public/matching gần nhất trên cùng worktree đã pass.

Tuy nhiên dự án **chưa sẵn sàng staging**. Rủi ro lớn nhất không phải thiếu API cơ bản mà là tính tái lập release và safety gate: worktree có rất nhiều source/migration chưa commit, chỉ 5/16 migration đang được Git track, development DB có schema đúng nhưng chưa có migration history. Authenticated E2E có code và artifact thành công, nhưng suite lifecycle hiện ghi fixture vào development DB nên chưa phải release evidence cô lập/repeatable.

Không phát hiện P0 đã xác nhận. Có sáu P1: release artifacts chưa được version-control đầy đủ, development migration history chưa chuẩn hóa, password-reset frontend thiếu, lưu job/screening questions không nguyên tử, alert worker có thể gửi trùng khi lỗi/chạy đồng thời, và thiếu authenticated E2E cô lập.

| Chỉ số | Kết quả hiện tại |
|---|---|
| Backend tests chạy trong audit | 12/12 files, 95/95 tests pass; Prisma/Gemini/SMTP được mock |
| Frontend lint chạy trong audit | Exit 0; 11 warning `set-state-in-effect`, 0 error |
| Frontend production build gần nhất, cùng worktree | Pass; 640 modules; initial main JS khoảng 274.82 kB |
| Matching/public production-preview E2E gần nhất | Matching 1/1; lazy/public performance 3/3 |
| Authenticated E2E | Có suite và artifact pass; **NOT VERIFIED trên DB cô lập** trong audit này |
| Database chain | 16/16 pass trên MySQL trắng; clone resolve/checksum/diff/integrity pass |
| Git migration tracking | 5/16 tracked; 11/16 untracked — release blocker |
| Staging | Chưa triển khai; tổng thể **NO-GO** |

## 2. Current Architecture Overview

```text
React 19 + React Router + Vite
  └─ in-memory access token + HttpOnly refresh cookie
       └─ Express 5 REST API (validation, auth/RBAC, rate limits)
            ├─ Prisma ORM ──> MySQL (35 models)
            ├─ Matching V1 / gated V2 / offline-shadow V3
            ├─ Gemini LLM/embedding adapters (optional, retry/timeout)
            ├─ local CV/logo storage
            └─ cron job-alert worker ──> notifications + SMTP
```

### Main modules and data flow

| Layer | Implementation | Notes/evidence |
|---|---|---|
| Frontend routing | `front-end-web/src/routes/AppRoutes.jsx:46` | Lazy routes; role guards for Candidate/Recruiter/Admin |
| API client/session | `front-end-web/src/services/api.js:25`, `front-end-web/src/context/AuthContext.jsx:25` | Token kept in memory; one refresh promise prevents duplicate refresh in a tab |
| API composition | `back-end/src/app.js:74` | Helmet, credentialed CORS, global rate limit, 10 route modules |
| Auth/RBAC | `back-end/src/middleware/auth.js:6`, `back-end/src/routes/auth.routes.js:149` | HS256 allowlist, issuer/audience/sub checks, token version, atomic refresh claim/replay handling |
| Database | `back-end/prisma/schema.prisma` | 35 models, 9 enums; candidates, jobs, applications, messaging, alerts, audit and AI caches |
| Matching | `back-end/src/services/matching.service.js:178` | Deterministic V1; V2/V3 feature gates; finite-vector validation |
| Gemini | `back-end/src/services/llm.service.js`, `back-end/src/services/embedding.service.js` | Timeout, bounded retry, typed errors, structured-output validation |
| Background work | `back-end/src/jobs/alertWorker.js:12` | In-process cron; currently lacks distributed/overlap lock and idempotent delivery key |
| File storage | `back-end/src/routes/candidates.routes.js:620`, `back-end/src/routes/companies.routes.js:145` | Local paths configurable; staging requires persistent volume and separate backup |

Architectural constraints worth keeping: no generic client-selectable matching version; V2 source remains for forensic comparison but is gated; V3 has no public route; access tokens are not persisted in browser storage.

## 3. Feature Completeness Matrix

Status meanings: **Complete** = UI + API + authorization + persistence exist and have relevant evidence; **Partial** = usable implementation exists but a flow, state or safe verification is missing; **Missing** = no end-user implementation found; **Not verified** = source exists but runtime evidence is unsafe/unavailable.

### Public

| Feature | Status | Evidence / gap |
|---|---|---|
| Landing/home page | **Missing** | `/` falls through `*` to `GuestRoute`, which renders login/register UI: `AppRoutes.jsx:61` |
| Job list/search/filter/sort/pagination | **Complete** | UI `JobBoardPage.jsx`; API `jobs.routes.js:122` |
| Job detail | **Complete** | `/jobs/:id`; public contract integration tests pass |
| Company detail, jobs and approved reviews | **Complete** | `CompanyPage.jsx`; `companies.routes.js:114` |
| Company directory/list | **Missing** | No public `/companies` route or page; only `/:id` and recruiter `/me` |
| Register/login | **Complete** | Candidate/recruiter registration and generic login; admin uses seeded account |
| Password recovery | **Partial** | Backend request/confirm exists, but no frontend API methods, route or reset form; email points to `/reset-password`: `auth.routes.js:187` |
| Responsive/public lazy loading | **Complete with evidence** | Production-preview public/lazy suite 3/3; role matrix artifacts have no horizontal overflow |

### Candidate

| Feature | Status | Evidence / gap |
|---|---|---|
| Profile, skills, education, experience, projects | **Complete** | `CandidateProfilePage.jsx`; CRUD routes generated at `candidates.routes.js:489` |
| CV upload/download/default/import | **Partial** | Upload/security/import/confirm exist; AI import needs Gemini and has only mocked verification |
| Search/save/apply/withdraw/status timeline | **Complete in source** | `JobBoardPage.jsx`, `MyJobsPage.jsx`; application transaction at `applications.routes.js:100` |
| Screening questions | **Complete** | Typed frontend wizard + backend validation and answer persistence |
| Recommendations and V1 job match | **Complete, conditional** | V1 score works without Gemini; explanation fallback tested |
| CV–job AI analysis | **Partial** | Explicit UI/API exists; missing real staging integration and unavailable without Gemini |
| Job alerts | **Partial** | CRUD UI/API exists; worker delivery is not production-safe yet |
| Notifications | **Partial / confirmed UI bug** | Notification state is wired only by `JobBoardPage.jsx:263`; bell on other pages is inert and item `link` is not navigated |
| Messages | **Complete in source** | Participant checks, send/read and UI polling exist; isolated full E2E missing |
| Talent invitation response | **Missing UI** | Backend response endpoint exists at `candidates.routes.js:119`; no frontend caller/inbox found |
| Follow/review company | **Complete in source** | Candidate-only API and company detail UI |

### Recruiter

| Feature | Status | Evidence / gap |
|---|---|---|
| Company profile/logo | **Complete in source** | `/companies/me`, signature-validated upload, dashboard form |
| Job create/edit/draft/submit/close | **Partial / data consistency risk** | End-to-end UI exists, but job/skills and screening-question replacement are separate DB operations: `jobs.routes.js:302-342` |
| Application management | **Complete in source** | List/detail/status/history, bulk reject, internal notes, CV authorization |
| Recruitment pipeline | **Complete in source** | Drag/drop pipeline, score filter, funnel and notes |
| Screening questions | **Complete functionally** | Wizard/API present; inherits non-atomic save risk |
| Talent search/saved search/invite | **Partial** | Search/invite UI/API exists; candidate cannot view/respond through UI |
| AI job description | **Partial** | Manual fallback remains possible; Gemini path only mocked |
| Candidate recommendation | **Complete, conditional** | V1 scoring and rule explanation fallback |
| Dashboard/statistics | **Complete in source** | `recruiters.routes.js:12`, charts in `RecruiterDashboardPage.jsx` |
| Messages | **Complete in source** | Conversation only for applications owned by recruiter company |
| Notifications | **Partial** | Backend creates them; global UI/deep-link issue prevents reliable consumption |

### Admin

| Feature | Status | Evidence / gap |
|---|---|---|
| Authentication/RBAC | **Complete in source/tests** | All admin routes use `authenticate, authorize('ADMIN')`: `admin.routes.js:92` |
| Dashboard/statistics | **Complete** | Stats/time grouping plus charts |
| User management | **Complete** | List/detail/ban/unban; session revocation and audit log |
| Job/review moderation | **Complete** | Ownership-independent admin moderation with audit and notifications |
| Audit logs | **Complete** | Filtered/paginated backend and UI table |
| Company management | **Partial** | `GET /api/admin/companies` exists, but `adminApi` and Admin UI do not expose it |
| Historical HTTP 403 | **Resolved in current source; live rerun constrained** | Root cause was Admin polling candidate/recruiter unread endpoint. `AppShell.jsx:50-56` now polls only Candidate/Recruiter; dedicated test exists and current role-matrix artifact reports zero API failures |

### AI

| Capability | Status | Evidence / decision |
|---|---|---|
| Matching V1 | **GO conditional** | Deterministic, finite, Gemini-independent; recommendation/explanation fallback tests pass |
| V2 legacy | **NO-GO / disabled** | `text-embedding-004` is retired; frontend/route/service gates default false; candidate gets 410 |
| V3 embedding | **NO-GO user traffic** | New cache/version contract and mocked failure coverage exist; no public endpoint, live Gemini proof or valid benchmark |
| CV extraction/analysis | **Partial** | Structured schema validation and rate limiting exist; real provider not tested |
| Job description generation | **Partial** | Retry/error handling exists; manual editing remains available |
| Chatbot | **Partial** | Role-restricted tool-calling exists; requires Gemini and lacks safe live/E2E evidence |
| Evaluation/benchmark | **Not release-valid** | Framework/tests exist, but dataset lacks verified provenance, sufficient labels and human agreement |

## 4. End-to-End Business Flow Status

| Flow | UI → API → DB/RBAC status | Test evidence | Verdict |
|---|---|---|---|
| Register → login → refresh → logout | Full implementation; refresh rotates atomically and logout bumps token version | Backend integration mock pass; frontend auth E2E exists but writes session records | **Partial: isolated browser verification missing** |
| Candidate profile → search → apply → track | Full implementation including CV ownership, answers, match score and status history | Backend apply/duplicate/withdraw pass; existing dev lifecycle artifact pass | **Partial: not rerun on isolated DB** |
| Recruiter create → submit → moderation → process candidate | Full UI/API/RBAC; screening save is non-atomic | Ownership/status/admin tests pass; existing lifecycle artifact pass | **Partial: P1 atomicity + isolated E2E** |
| Candidate ↔ Recruiter messaging | Full participant checks, conversation creation, sanitize/send/read | Backend integration pass; existing lifecycle artifact shows both directions | **Partial: isolated browser verification missing** |
| Admin login → admin operations | Role guard and backend RBAC correct; old unread poll fixed | Cross-role integration pass; existing current role-matrix artifact has zero failures | **Mostly complete; isolated login/action E2E pending** |
| Candidate V1 matching → fallback | UI uses only unversioned V1; score does not require Gemini | Unit/integration 95/95 and matching E2E 1/1 | **Complete within tested V1 scope** |
| Notification/email | Events are created for apply/status/moderation/follow/invite/alerts | Worker test uses mock mail; notification UI is page-local; SMTP unverified | **Incomplete** |

Important safety note: public `GET /api/jobs/:id` writes a deduplicated `JobView` record (`jobs.routes.js:295-297`). Consequently even “public read-only E2E” can mutate a real database and must use an isolated DB for strict read-only verification.

## 5. Bug & Technical Debt Backlog

| ID | Priority | Classification | Finding and evidence |
|---|---|---|---|
| REL-01 | P1 | Confirmed technical debt | Worktree contains extensive modified/untracked runtime code; only 5/16 migrations are tracked. A clean checkout cannot reproduce the audited application/schema. |
| DB-01 | P1 | Confirmed release blocker | Development schema matches Prisma but all 16 migrations remain unrecorded; staging must not proceed before approved baseline-history normalization. |
| AUTH-01 | P1 | Missing feature | Backend issues `/reset-password?token=...`, but frontend has no route/form/client calls, so users cannot complete recovery. |
| DATA-01 | P1 | Confirmed consistency bug | Job create/update and screening-question create/delete run outside one transaction; failure can leave partial job state or delete questions without replacement. |
| ALERT-01 | P1 | Confirmed reliability bug | Worker creates notification before email and advances `lastSentAt` afterward. Email failure causes duplicate notification on retry; concurrent/API replicas have no lease or idempotency key. |
| QA-01 | P1 | Untested behavior | Authenticated lifecycle suite targets configured API/DB and creates fixtures; no proven disposable DB reset/cleanup contract. |
| NOTIF-01 | P2 | Confirmed functional bug | AppShell renders notification bell globally, but only JobBoard supplies state/handlers; links are stored but click only marks read and never navigates. |
| CAND-01 | P2 | Missing feature | Candidate has no invitation inbox/accept/reject UI although recruiter invite and backend response endpoint exist. |
| ADMIN-01 | P2 | Missing feature | Admin company list API exists, but no API client method or UI section. |
| PUBLIC-01 | P2 | Missing feature | No public landing page or company directory; root route displays auth UI for guests. |
| AI-01 | P2 | Untested behavior | Gemini LLM/V3 compatibility is verified only with mocks; credentials/quota/real response contract remain unknown. |
| AI-02 | P2 | Test/data gap | Matching dataset is insufficient for human-ground-truth ranking claims; V3 cannot be promoted. |
| MAIL-01 | P2 | Untested behavior | SMTP password reset and job-alert delivery have no sandbox integration proof; missing SMTP silently skips delivery by design. |
| API-01 | P2 | Technical debt | Same recommendations router is mounted at `/api/recommendations` and `/api/ai`, exposing unintended aliases such as `/api/ai/jobs` and `/api/recommendations/chat`: `app.js:83-84`. |
| PERF-01 | P2 | Technical debt | Each Candidate/Recruiter tab polls unread/messages every five seconds without visibility/backoff coordination; scale and rate-limit behavior are unmeasured. |
| QA-02 | P2 | Test gap | Frontend has Playwright tests but no component/unit/contract suite; loading/error/empty/form behavior is weakly isolated. |
| ANALYTICS-01 | P3 | Suspected concurrency bug | Job-view dedupe is check-then-create with only a non-unique index; concurrent requests may create duplicate views. |
| CODE-01 | P3 | Technical debt | `CandidateApplicationsPage.jsx` and `SavedJobsPage.jsx` remain but routes redirect to `MyJobsPage`; duplicate/dead UI can drift. |
| LINT-01 | P3 | Technical debt | 11 React `set-state-in-effect` warnings remain; no current runtime failure demonstrated. |
| DOC-01 | P3 | Technical debt | Frontend README is still the Vite template and does not document runtime flags, auth/E2E setup or route behavior. |

No critical security vulnerability was promoted to “confirmed” without evidence. Existing controls include strict CORS validation, Helmet, rate limits, token hashing/rotation, JWT algorithm/issuer/audience checks, input schemas, file-signature validation, CV ownership checks and generic 500 responses. Dependency vulnerability scanning was not run because it may require network/current registry metadata; this remains part of QA/security readiness.

## 6. Test Coverage & Verification Gaps

| Area | Current evidence | Gap / interpretation |
|---|---|---|
| Backend unit/integration | **95/95 pass now**; 89 declared `it/test` cases plus parameterized cases | Broad mocked coverage, not a real MySQL integration suite |
| Auth/RBAC/security | Register/login/refresh/logout, replay, cross-role, ownership, CV privacy pass | Browser auth lifecycle not verified against disposable DB |
| Frontend static | Lint exit 0, 11 warnings | No type checking and no component tests |
| Frontend build | Same-worktree production build pass (640 modules) before this audit | Not rerun to honor single-output/read-only constraint; build success is not business proof |
| Public E2E | Public detail and production lazy/preload evidence pass | Job detail writes JobView, so real-DB “read-only” label is inaccurate |
| Matching E2E | Fully mocked 1/1 pass; no V2 request | Does not prove real provider, which is intentionally out of scope |
| Candidate/Recruiter/Admin E2E | Suites and same-day artifacts cover responsive matrix and lifecycle | Lifecycle writes identified dev fixtures; not accepted as isolated release gate |
| Responsive | 375/390/430/1440 artifacts show no horizontal overflow and working drawers | Visual assertions cover representative routes, not every modal/table/error state |
| Database migration | Blank MySQL chain, repeated deploy, retained backup/restore clone and resolve rehearsal pass | Git tracking and development history approval remain blockers |
| AI benchmark | Metric framework/unit tests exist | Dataset provenance/coverage/agreement do not permit quality claims |

Safe commands executed in this audit:

```powershell
cd back-end
npm test        # 12/12 files, 95/95 tests

cd ..\front-end-web
npm run lint    # exit 0, 11 warnings
```

Not executed: authenticated/public real-DB E2E, coverage generation, build artifact generation, Prisma write commands, SMTP/Gemini calls, dependency install/audit, staging/production deployment.

## 7. Database & AI Risk Assessment

### Database

- Current development schema and `schema.prisma` have no structural diff, but `_prisma_migrations` is absent and `migrate status` reports 16 unapplied migrations.
- A full logical backup was restored to an independent clone. Resolving all 16 migrations on the clone produced 16 matching checksums, empty schema diff, unchanged 232 business rows and zero orphans across 50 foreign keys.
- The chain deploys successfully from blank MySQL and is idempotent on a second deploy.
- **Release remains NO-GO** because 11 migrations are untracked and development history has not been normalized with approval.
- CV/logo/uploads are outside MySQL and require a matching persistent-volume backup/recovery test.
- Never run `db push`, `migrate reset`, `migrate deploy` or unapproved `migrate resolve` on the existing development DB.

### AI

- V1 remains the only user-traffic-safe matching version. Score calculation is independent of Gemini; Gemini explanation failure falls back to deterministic text.
- V2 must remain disabled at frontend, route and service. Its `text-embedding-004` dependency is retired; source/cache must not be silently migrated or mixed with V3.
- V3 uses a distinct model/version/instruction/dimension cache identity and reports degraded V1 fallback explicitly. It must not be called “V3 PASS” when fallback occurs.
- Current model/contract review and mock tests are necessary but insufficient. Before V3 shadow testing: staging-only key, synthetic/consented data, redacted logs, pinned model version, quota/cost limit and verified dimensions are required.
- Before V3 user traffic: verified human labels, at least two evaluators, agreement threshold, same-snapshot V1/V3 comparison, privacy review and rollback/canary evidence are required.

## 8. Prioritized Development Roadmap

Every task below has an explicit acceptance and verification gate. “Mandatory” means required for the stated staging-ready target; optional items improve product completeness but do not block a V1-only technical staging smoke unless noted.

### Phase 1 — Critical Stabilization

| Task | Work / files | Pri. / type | Dependency / required | Acceptance criteria | Verification | Size |
|---|---|---|---|---|---|---:|
| REL-01 | Review and version all intended runtime/migration/config/test changes; `git status`, `back-end/prisma/migrations/**` | P1 / Technical Debt | None / **Mandatory** | Clean checkout contains exactly 16 immutable migrations and all audited runtime code; checksums reviewed | Fresh clone install-free static inventory, Git tracked-file check, checksum table | M |
| DB-01 | Normalize development migration history following approved baseline plan; migration reports/scripts | P1 / Technical Debt | REL-01, backup/freeze, explicit approval / **Mandatory** | 16 successful history rows, checksum match, status up to date, empty diff, data/FK invariants unchanged | Pre/post dump checksum, row counts, Prisma status/diff; rollback drill | M |
| DATA-01 | Make job + skills + screening-question create/update atomic; `jobs.routes.js:302-342` | P1 / Bug | Stable migration/schema / **Mandatory** | Any injected failure rolls back job, skills and questions together | Real/test MySQL transaction tests for create and replacement failure | M |
| ALERT-01 | Add worker lease/idempotent delivery/outbox semantics; `alertWorker.js`, Prisma schema/migration | P1 / Bug | REL-01; DB design / **Mandatory before worker enabled** | Retry or overlapping workers produce one logical notification/email; recoverable failure state | Two concurrent worker integration runs + simulated SMTP failure | L |
| AUTH-01 | Add forgot/reset UI and API client; `AuthPage.jsx`, `AppRoutes.jsx`, `api.js` | P1 / Feature | SMTP sandbox for full proof / **Mandatory** | User requests reset, opens token link, resets password; invalid/expired/used token UX defined | Component + backend contract + isolated browser test with mail capture | M |
| QA-01 | Build disposable authenticated E2E environment and fixture lifecycle; Playwright global setup/config | P1 / Test | REL-01, migration chain / **Mandatory** | Tests refuse non-test DB, provision/reset safely, run independently/repeatedly without dev changes | Two consecutive full runs; before/after dev DB fingerprint unchanged | L |

### Phase 2 — Core Feature Completion

| Task | Work / files | Pri. / type | Dependency / required | Acceptance criteria | Verification | Size |
|---|---|---|---|---|---|---:|
| NOTIF-01 | Move notification state/actions to shared authenticated shell; navigate safe internal links; `AppShell.jsx`, auth/layout context | P2 / Bug | QA-01 / **Mandatory** | Bell works on every authenticated page; unread count updates; item opens intended entity; errors visible | Candidate/recruiter/admin component + E2E tests | M |
| CAND-01 | Candidate invitation inbox and accept/reject UI; candidate routes/API/page | P2 / Feature | NOTIF-01 / **Mandatory for complete talent flow** | Candidate can view/respond once; recruiter sees updated status | API ownership tests + two-role E2E | M |
| ADMIN-01 | Expose company list/detail/filter in Admin UI; `AdminDashboardPage.jsx`, `api.js` | P2 / Feature | QA-01 / Optional for minimal staging, required for stated admin scope | Admin can list/search/view companies with proper empty/error states | Mocked component + isolated admin E2E | M |
| PUBLIC-01 | Add landing page and public company directory; frontend routes/pages plus public list API if needed | P2 / Feature | Product decision on scope / Optional | `/` is intentional landing; company list is searchable/paginated; responsive | Public contract/component/E2E at four viewports | L |
| API-01 | Split AI and recommendation routers or explicitly document/test aliases; `app.js`, `recommendations.routes.js` | P2 / Technical Debt | API contract decision / **Mandatory before public staging** | Only intended endpoint paths return non-404; no accidental duplicate surface | Route inventory snapshot + RBAC tests | S |

### Phase 3 — AI Reliability

| Task | Work / files | Pri. / type | Dependency / required | Acceptance criteria | Verification | Size |
|---|---|---|---|---|---|---:|
| AI-01 | Staging-only Gemini contract smoke with synthetic data and redacted logs | P2 / Test | Separate staging key/quota/privacy approval / Optional for V1-only; **mandatory for V3** | 200, timeout, 429, 5xx, malformed vector and missing-key behavior recorded; no secret/CV leakage | Provider smoke report; fallback never counted as V3 success | M |
| AI-02 | Produce verified human-ground-truth dataset and agreement | P2 / Test | Evaluators/rubric approval / **Mandatory for V3 promotion** | Provenance, snapshot, ≥2 evaluators, sufficient query/job/grade coverage and agreement | Dataset validator + reproducible V1/V3 evaluation | L |
| MAIL-01 | Verify SMTP sandbox for reset/application/alert emails | P2 / Test | AUTH-01, ALERT-01, safe SMTP / **Mandatory before email claims** | Delivery, retry, redaction, unsubscribe and failure UX work without real-user mail | Mail-capture integration tests | M |

### Phase 4 — Quality Assurance

| Task | Work / files | Pri. / type | Dependency / required | Acceptance criteria | Verification | Size |
|---|---|---|---|---|---|---:|
| QA-02 | Add frontend component/contract tests for guards/forms/loading/error/empty states | P2 / Test | Stable contracts / **Mandatory** | Critical role pages and auth/notification forms have deterministic isolated coverage | CI test job with failure-state fixtures | L |
| PERF-01 | Replace uncoordinated 5s polling with visibility-aware backoff or real-time design; `AppShell.jsx`, `MessagesPage.jsx` | P2 / Technical Debt | Metrics/budget / Optional for small staging, mandatory before scale | Hidden tabs stop/reduce polling; rate limit and latency budgets documented | Multi-tab network test and load test | M |
| ANALYTICS-01 | Make job-view recording idempotent/concurrency-safe or async; `jobs.routes.js:295`, `JobView` | P3 / Bug | Analytics semantics decision / Optional | Concurrent same-viewer requests count according to defined rule without duplicate race | Concurrent integration test against MySQL | M |
| LINT-01 | Resolve 11 effect-state warnings without behavior changes | P3 / Technical Debt | Component tests / Optional | Lint has 0 warnings/errors; no loading/refresh regression | Lint + component/E2E regression | S |

### Phase 5 — Deployment Readiness and Cleanup

| Task | Work / files | Pri. / type | Dependency / required | Acceptance criteria | Verification | Size |
|---|---|---|---|---|---|---:|
| CODE-01 | Remove or consolidate unused Candidate applications/saved pages | P3 / Technical Debt | Route/product decision / Optional | One canonical implementation per flow; no orphan imports/styles | Route inventory + navigation regression | S |
| DOC-01 | Replace frontend template README with real setup/flags/test/deploy docs | P3 / Technical Debt | Contracts stabilized / Optional | Clean-checkout developer can configure and run without hidden knowledge | Documentation dry run | S |

Parallelization: after REL-01, DATA-01/AUTH-01/QA-01 can proceed in parallel. AI-02 can start independently from AI-01, but V3 promotion requires both. UI completion tasks should consume QA-01/QA-02 fixtures rather than adding new development-DB-dependent tests.

## 9. Top 5 Tasks To Start Immediately

1. **REL-01 — Freeze a reproducible release candidate:** review and track the intended source plus all 16 migrations. Until then every other pass result is tied to one dirty workstation.
2. **QA-01 — Create a disposable authenticated E2E environment:** this converts existing Candidate/Recruiter/Admin flows from risky evidence into repeatable release gates.
3. **DB-01 — Complete approved development baseline history:** only after REL-01, retained backups, file-volume backup and explicit confirmation.
4. **DATA-01 — Make recruiter job/screening saves transactional:** prevents partial business data during a central workflow.
5. **ALERT-01 — Add idempotency/locking before enabling the worker:** prevents duplicate notifications/email and overlapping worker execution.

AUTH-01 is the next P1 immediately after these safety/reliability foundations, or can run in parallel with DATA-01 if a separate developer is available.

## 10. Open Questions & Decisions Requiring Approval

1. Which modified/untracked files are intended for the release candidate, and may they now be staged/committed after review?
2. Where are CV/logo/upload files stored, and what backup/restore target must accompany the verified MySQL dump?
3. After migrations are immutable in Git and writes are frozen, do you authorize the documented 16-step `migrate resolve --applied` procedure on development?
4. Is a public landing page and company directory required for the first staging scope, or may `/jobs` be the public entry point?
5. Should HTTP 410 remain the permanent V2 contract, and should the dormant frontend `matchV2` helper stay for diagnostics?
6. May a dedicated local/test MySQL database be provisioned and reset for authenticated E2E? Development must remain out of scope.
7. Which SMTP sandbox and staging-only Gemini project/key may be used later, and who approves synthetic/consented test data?
8. Who will serve as the two independent AI relevance evaluators, and what agreement threshold is accepted?
9. Should notification links use route/query deep links into the existing single-page recruiter/admin dashboards, or should dedicated detail routes be added?

### Priority count

| Priority | Count |
|---|---:|
| P0 | 0 |
| P1 | 6 |
| P2 | 10 |
| P3 | 4 |
| **Total** | **20** |

Overall staging decision: **NO-GO** until at least REL-01, QA-01 and DB-01 pass, DATA-01 is resolved or explicitly risk-accepted, and V2/V3 remain disabled. After audit/roadmap delivery, no implementation task is started without user confirmation.
