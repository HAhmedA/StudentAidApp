# Comprehensive Code Review — Final Report

**Application:** Student Wellbeing Dashboard (Node.js/Express + React + PostgreSQL)
**Review Date:** 2026-03-11
**Commits Reviewed:** `04eaee5` (P1 fixes), `d524dc2` (chatbot/gauges)
**Phases Completed:** Code Quality, Architecture, Security, Performance, Testing, Documentation, Best Practices, CI/CD

---

## Executive Summary

The codebase shows consistent improvement across recent sprints: parameterised SQL throughout, `asyncRoute` error handling, extracted scoring helpers, paginated admin endpoints, injectable cron service, and four well-structured operational runbooks. The scoring pipeline in particular is cleanly layered and well-tested for its core paths.

However, the review identified **two functional bugs** (mood router never mounted, wrong build arg in `compose.yml`), **two Critical security findings** (hand-rolled session signing, plaintext HTTP deployment), and **three Critical operational findings** (no automated deployment, same two security issues carrying through to ops). The most significant systemic issue is a compound observability gap: Sentry is bypassed by `asyncRoute` (BP-05), the health endpoint reports healthy during DB outages (OPS-09), and scoring errors are silently swallowed as `null` (AR-11) — three independent blind spots that together mean a broken deployment can go undetected for hours.

**Total findings:** 90 across 8 categories
**Critical:** 7 | **High:** 26 | **Medium:** 36 | **Low:** 21

---

## Findings by Priority

---

### P0 — Critical: Fix Immediately

#### SEC-01 — Hand-Rolled Session Cookie Signing (CVSS 9.1, CWE-347)
**`authController.js` lines 11–15.** `signSessionId()` reimplements `cookie-signature`'s HMAC-SHA256 with manual base64url substitution that the library does NOT perform. If the signatures diverge, every real-browser login silently fails session restoration — or an attacker who discovers the divergence can craft cookies that pass one verification path.
**Fix:** `import { sign } from 'cookie-signature'` and replace with `'s:' + sign(id, secret)`.

#### SEC-02 / OPS-02 — Plaintext HTTP Deployment with Session Cookies (CVSS 9.0, CWE-319)
**`compose.http.yml`, `deployment.md`.** Production runs on port 80, `COOKIE_SECURE=false`, HSTS disabled. Session cookies — including for admin accounts — are transmitted in cleartext. On a university campus network, passive session hijacking is trivially easy.
**Fix:** Switch deployment runbook to `compose.prod.yml` with Caddy automatic TLS, or add Cloudflare Tunnel.

#### OPS-01 — No Automated Deployment
All releases are manual SSH sessions with no audit trail, no rollback automation, and risk of operator error. A failed mid-deployment build leaves the service down until manually corrected.
**Fix:** Add a CD GitHub Actions job on push to `main` using `appleboy/ssh-action`. Tag Docker images with the Git SHA for one-command rollback.

#### DOC-03 — Mood Router Never Mounted (Functional Bug)
**`routes/index.js`.** `mood.js` is never imported or mounted. All mood endpoints are silently unreachable at runtime despite the frontend expecting them.
**Fix:** Add `import moodRoutes from './mood.js'` and `router.use('/mood', moodRoutes)` to `routes/index.js`.

#### DOC-08 / OPS-03 — Wrong Build Arg in `compose.yml` (Functional Bug)
**`compose.yml` line 9.** `REACT_APP_API_BASE` is passed but Dockerfile expects `VITE_API_BASE`. The arg is silently discarded; the baked-in API URL may be incorrect in any environment relying on `compose.yml` alone.
**Fix:** Rename to `VITE_API_BASE: "/api"` in `compose.yml`.

#### SEC-03 — Legacy Login Creates Arbitrary Admin Sessions from User Input (CVSS 8.1, CWE-287)
**`auth.js` lines 133–147.** `POST /legacy-login` accepts `{ role: 'admin' }` with no credential check. The only guard is `NODE_ENV === 'production'`, which defaults to `'development'` when `NODE_ENV` is unset.
**Fix:** Remove `/legacy-login` entirely or guard with an explicit `ENABLE_DEMO_LOGIN=true` env var; never derive `role` from user input.

---

### P1 — High: Fix Before Next Deployment

#### Security
- **SEC-04** — Admin role bypasses all rate limiting (`rateLimit.js:11`); compromised admin has unrestricted API access including expensive endpoints. Replace bypass with a higher per-admin limit.
- **SEC-05** — LLM API key stored in plaintext in the `llm_config` table. Encrypt at rest or move to a secrets manager.
- **SEC-06** — SSRF via admin-controlled LLM base URL (`admin.js:544`). `new URL()` validation does not block `169.254.169.254`. Add IP range blocklist.
- **SEC-07** — `POST /surveys/changeJson` has no auth guard (CWE-862). Any unauthenticated caller can overwrite survey JSON. Add `requireAdmin`.
- **SEC-08** — `POST /results/post` accepts anonymous submissions, inserting `user_id = null` rows (CWE-862). Add `requireAuth`.

#### Architecture
- **AR-02** — `batchComputeClusterScores` bypasses `_persistClusterResults` and `_computeUserPercentile` helpers, re-implementing the same logic inline. Partial refactor leaves inconsistency and makes percentile logic diverge.
- **AR-06** — `server.js` imports `{ ensureFixedSurvey }` from `routes/surveys.js`, violating the infrastructure→service→route dependency direction. Move to a service module.
- **AR-11** — `computeConceptScore` swallows all errors with `return null`, conflating "no data" with "threw an error". Propagate errors to the caller.

#### Performance
- **PERF-01** — O(N²D log N) batch scoring: `batchComputeClusterScores` calls `computeCompositeScore` in an N-user loop, which re-sorts allValues (O(N log N)) per dimension. Pre-computed ranges from `_runConceptClustering` exist but are not passed through.
- **PERF-02** — `composites.filter(…).sort(…)` runs N times in the batch loop. Pre-group by cluster index once before the loop.
- **PERF-03 / OPS-05** — DB pool has no explicit `max`, `idleTimeoutMillis`, or `connectionTimeoutMillis`. Add explicit config.
- **PERF-06** — Missing composite indexes on all hot query paths: `lms_sessions(user_id, is_simulated, session_date)`, `sleep_sessions`, `screen_time_sessions`, `chat_sessions(user_id, is_active, created_at)`, `concept_score_history(user_id, concept_id, score_date)`. Add a migration.

#### Testing
- **TEST-01** — No end-to-end test verifies that the signed cookie from login is accepted by `express-session`'s verify mechanism.
- **TEST-02** — `/legacy-login` admin attack path is not tested end-to-end.
- **TEST-03** — No test asserts `401` on unauthenticated `POST /surveys/changeJson`.
- **TEST-05** — `csvLog` route (5 endpoints, including a manual `BEGIN/COMMIT` transaction) has zero test coverage.
- **TEST-06** — `computeSRLClusterScores` (130 lines, 0% coverage). The DIAG_SAMPLE cap was not applied to SRL's `storeDiagnostics`, so large SRL cohorts compute full O(N²) silhouette scores.
- **TEST-07** — `batchComputeClusterScores` and `batchScoreLMSCohort` are completely untested.
- **TEST-08** — `register` endpoint has no tests at all.
- **TEST-09** — `logout` endpoint has no tests at all.

#### Documentation
- **DOC-04** — Multiple admin endpoints lack Swagger annotations, including the destructive `DELETE /admin/clear-student-data`.
- **DOC-05** — LMS bulk sync async pattern (202 + jobId polling) undocumented. In-memory job store limitation not surfaced in API docs.
- **DOC-06** — 6 chat endpoints missing Swagger annotations; `GET /chat/initial` returns two distinct response shapes with no documentation.
- **DOC-07** — `DEBUG_LLM`, `COOKIE_SECURE`, and `EC2_HOST` missing from `.env.example`.
- **DOC-09** — Deployment runbook says "4 services" when only 3 exist.

#### CI/CD
- **OPS-04** — Backup cron not provisioned by IaC; no offsite upload; no verification that backups are actually running. Data loss risk on EC2 instance loss.

---

### P2 — Medium: Plan for Next Sprint

#### Security
- **SEC-09** — Moodle token exposed in GET URL query strings (may appear in server/Moodle logs).
- **SEC-10** — `DEBUG_LLM=true` logs full chat payloads to stdout; no guard prevents this in production.
- **SEC-11** — Session secret falls back to hardcoded `'dev-secret'`; generate a random secret on startup instead.
- **SEC-12** — No CSRF token mechanism beyond `SameSite=Lax`.

#### Architecture
- **AR-03** — `SIMULATION_MODE` evaluated at module load time in `scoreQueryService.js`; tests that set this env var after import see stale behaviour.
- **AR-05** — The ~25-line score-mapping loop is still duplicated between `admin.js` and `scores.js`. Extract a `mapScoreRow()` helper.
- **AR-09** — `contextManagerService.js` mixes 6+ concerns (session CRUD, AI orchestration, greeting, alignment, summarization). Extract `chatOrchestrationService.js`.
- **AR-12** — No API response versioning strategy; new fields added to score responses break clients silently.

#### Performance
- **PERF-04** — Nightly cron processes users sequentially; `p-limit` (already a dependency) could parallelize 3–5 users for 3–5× speedup.
- **PERF-07** — Silent null from scoring errors means failed computations contribute to `successCount` instead of `errorCount`.
- **PERF-08** — `getOrCreateSession` makes 3 sequential DB round-trips; consolidate into a single CTE query.
- **PERF-10** — Moodle forum sync cap (`MAX_FORUM_DISCUSSIONS_PER_SYNC = 50`) silently drops posts for active courses.

#### Code Quality
- **CQ-01** — `signSessionId()` reimplements `cookie-signature` (also Critical in security — carry-over).
- **CQ-02** — `session.save()` + `setSessionCookie()` pattern duplicated in `login` and `register`. Extract a helper.
- **CQ-05** — `computeCompositeScore` re-sorts allValues per call in the batch path. Pass pre-computed ranges.
- **CQ-10** — `computeConceptScore` conflates `null` (no data) with `null` (error). Return a discriminated result object.
- **CQ-11** — `MIN_CLUSTER_USERS = 10` defined in `clusterPeerService.js` but used inline as literal `10` in `admin.js` and `scores.js`. Export and import the constant.

#### Best Practices
- **BP-02** — Startup work runs inside `app.listen` callback; no global `unhandledRejection` handler.
- **BP-04** — All non-AppError exceptions reclassified as misleading `DB_ERROR`.
- **BP-05** — `asyncRoute` never calls `next(err)`; global error handler and Sentry are dead code for all route errors.

#### Testing
- **TEST-10** — `scoreQueryService.js` never tested directly; `EXCLUDE_SIMULATED_USERS` logic untested.
- **TEST-13** — Rate limiter never fire-tested for actual 429 enforcement.
- **TEST-14** — `contextManagerService`, `promptAssemblerService`, `summarizationService` have no unit tests.

#### Documentation
- **DOC-10** — `GET /scores/:conceptId` missing Swagger annotation.
- **DOC-11** — Sleep and screen-time routes undocumented.
- **DOC-12** — Profile routes undocumented.
- **DOC-13** — CSV log routes (including `X-Filename` header and two-phase upload workflow) undocumented.
- **DOC-14** — README references `npm start` and port 3000 post-Vite migration.
- **DOC-15** — `DATABASE_URL` in `.env.example` points to `localhost:5433` — wrong inside Docker.
- **DOC-16** — Postgres major-version volume incompatibility not documented in runbook.
- **DOC-17** — `GET /annotations/chatbot` undocumented in Swagger.

#### CI/CD
- **OPS-06** — Node 18 EOL in CI and Dockerfiles. Upgrade to Node 20 LTS.
- **OPS-07** — No staging environment; dev/prod configurations diverge significantly.
- **OPS-08** — File-based secrets, no rotation mechanism, weak `.env.example` password placeholder.
- **OPS-09** — Health endpoint returns 200 unconditionally; Docker healthcheck reports healthy during DB outage.
- **OPS-10** — No Jest coverage threshold in CI; coverage computed but not enforced.
- **OPS-11** — Migration tooling present but absent from deployment runbook; concurrent-start advisory lock not documented.

---

### P3 — Low: Track in Backlog

- **CQ-04** — `batchComputeClusterScores` inlines `_mapDomainCategory` logic instead of calling the helper.
- **CQ-06** — Active-user UNION query duplicated in `cronService.js` and `admin.js`.
- **CQ-07** — `DURATION_THRESHOLDS.long` is dead code in `sleepAnnotationService.js`.
- **CQ-09** — Admin rate-limit bypass applies to all API routes including expensive ones.
- **AR-04** — Unused `dbPool` parameter in `computeClusterScores` signature.
- **AR-07** — Dual `/lms` router mount obscures API surface.
- **AR-08** — Legacy `/api/logout` and `/api/me` aliases undocumented.
- **AR-10** — `getScoresForChatbot` is an unnecessary passthrough with no added logic.
- **BP-06** — `__filename`/`__dirname` ESM shims redundant on Node ≥ 21.2.
- **BP-07** — `parseInt` without radix in query-param parsing.
- **BP-08** — Fire-and-forget `.catch()` repeated ~8 times; no shared utility.
- **BP-11** — `express` v4 superseded by stable v5; `uuid` v9 EOL.
- **BP-13** — `express-validator` `validate()` helper inconsistently used.
- **SEC-14** — Raw DB error messages in non-production responses.
- **SEC-15** — No per-account login lockout (IP-based rate limit only).
- **SEC-16** — Unauthenticated survey reads; legacy auth aliases undocumented.
- **TEST-11** — `storeDiagnostics` error-swallow path untested.
- **TEST-16** — `storeClusterResults` assertions too shallow.
- **TEST-18** — Test pyramid route-heavy; service unit tests underrepresented.
- **DOC-18** — Cron failure not covered in troubleshooting runbook.
- **DOC-19** — Legacy `/api/logout` and `/api/me` undocumented in Swagger.
- **OPS-12** — Nightly cron has no external liveness signal (dead-man's-switch).

---

## Findings by Category

| Category | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Code Quality | 1 | 1 | 5 | 5 | 12 |
| Architecture | 0 | 3 | 5 | 4 | 12 |
| Security | 2 | 4 | 6 | 5 | 17 |
| Performance | 1 | 5 | 4 | 2 | 12 |
| Testing | 4 | 5 | 4 | 3 | 16 (18 total incl overlap) |
| Documentation | 3 | 5 | 7 | 5 | 20 |
| Best Practices | 0 | 0 | 5 | 8 | 13 |
| CI/CD & DevOps | 2 | 3 | 6 | 1 | 12 |
| **Total** | **7** | **26** | **36** | **21** | **90** |

---

## Recommended Action Plan

### Immediate (this week — before any production data is collected from real students)

1. **Fix `compose.yml` build arg** (OPS-03/DOC-08): one-line rename, unblocks correct frontend builds. _Effort: XS_
2. **Mount mood router** (DOC-03): two-line change in `routes/index.js`. _Effort: XS_
3. **Remove or lock down `/legacy-login`** (SEC-03): delete or add `ENABLE_DEMO_LOGIN` guard. _Effort: S_
4. **Add `requireAdmin` to `POST /surveys/changeJson`** (SEC-07): one-line middleware addition. _Effort: XS_
5. **Add `requireAuth` to `POST /results/post`** (SEC-08): one-line middleware addition. _Effort: XS_
6. **Replace hand-rolled session signing** (SEC-01): swap `signSessionId()` body for `cookie-signature.sign()`. Add round-trip test. _Effort: S_
7. **Fix health endpoint** (OPS-09): add `SELECT 1` probe and return 503 on failure. _Effort: S_

### Short-term (next sprint)

8. **Add TLS via `compose.prod.yml`/Caddy** (SEC-02/OPS-02): assign a domain, update deployment runbook. _Effort: M_
9. **Add automated CD deployment** (OPS-01): GitHub Actions job on push to `main`. _Effort: M_
10. **Fix DB pool configuration** (PERF-03/OPS-05): add `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`. _Effort: XS_
11. **Add missing composite DB indexes** (PERF-06): write and apply a migration. _Effort: S_
12. **Fix PERF-01/PERF-02 batch scoring algorithm**: pass pre-computed ranges and pre-group cluster composites. _Effort: M_
13. **Add SEC-06 SSRF protection**: block private IP ranges in LLM base URL validation. _Effort: S_
14. **Add test coverage for register, logout, csvLog routes** (TEST-05, TEST-08, TEST-09). _Effort: M_
15. **Fix BP-05**: call `next(err)` in `asyncRoute` so Sentry and global error handler actually fire. _Effort: S_
16. **Add missing `.env.example` entries**: `DEBUG_LLM`, `COOKIE_SECURE`, `EC2_HOST`. _Effort: XS_

### Medium-term (next quarter)

17. Provision offsite backup automation with S3 upload (OPS-04). _Effort: M_
18. Upgrade Node to 20 LTS in Dockerfiles and CI (OPS-06). _Effort: S_
19. Add SRL cluster scoring tests and batch scoring tests (TEST-06, TEST-07). _Effort: M_
20. Complete Swagger annotation coverage for all routes (DOC-01–DOC-17). _Effort: L_
21. Extract `contextManagerService` concerns into `chatOrchestrationService` (AR-09). _Effort: L_
22. Create `compose.staging.yml` and document pre-release smoke-test procedure (OPS-07). _Effort: M_
23. Migrate to Express 5 (BP-11): eliminates `asyncRoute`, native async error propagation. _Effort: M_
24. Add Jest coverage threshold enforcement (OPS-10). _Effort: XS_

---

## Review Metadata

- **Review date:** 2026-03-11
- **Phases completed:** Code Quality, Architecture, Security, Performance, Testing, Documentation, Best Practices, CI/CD
- **Flags applied:** None (standard review)
- **Output files:**
  - `.full-review/00-scope.md` — Review scope
  - `.full-review/01-quality-architecture.md` — Code quality & architecture findings
  - `.full-review/01-architecture.md` — Full architecture findings detail
  - `.full-review/02-security-performance.md` — Security & performance findings
  - `.full-review/03-testing-documentation.md` — Testing & documentation findings
  - `.full-review/04-best-practices.md` — Best practices & CI/CD findings
  - `.full-review/05-final-report.md` — This report
