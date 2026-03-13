# Phase 3: Testing & Documentation Review

_Review date: 2026-03-11._

---

## Test Coverage Findings

### TEST-01 — Severity: Critical
**No End-to-End Test for Signed Cookie Round-Trip (SEC-01)**

The auth tests use `express-session` without `SESSION_SECRET`, so they never verify that the manually-signed `connect.sid` produced by `setSessionCookie()` is accepted by `express-session`'s verify mechanism on the next request. If the HMAC base64url encoding diverges from `cookie-signature`'s format, every real-browser login silently breaks session restoration — and the test suite would still be green.

**Recommendation**: Add an integration test using the full stack with `SESSION_SECRET` set, capturing `Set-Cookie` from login and replaying it on `GET /api/auth/me`, asserting `200 { email }`.

---

### TEST-02 — Severity: Critical
**`/legacy-login` Admin Attack Path Not Tested End-to-End**

The existing test confirms that production returns `404`. But no test verifies the non-production attack path: `POST /legacy-login { role: 'admin' }` → session set → protected admin route → `200`. Without this test, the actual attack surface is unverified, and there's no regression guard if the route is accidentally hardened or broken.

**Recommendation**: Add a test that establishes a legacy-admin session then calls `GET /api/admin/students`, asserting `200`. This documents the intentional dev-only bypass explicitly in the test record.

---

### TEST-03 — Severity: Critical
**`POST /api/surveys/changeJson` Has No Authentication — And No Test Asserting 401**

`surveys.js` has no `requireAuth`/`requireAdmin`. The test suite tests the happy path but never sends an unauthenticated request and expects a rejection. The absence of the guard + absence of the test means neither the bug nor its absence is observable.

**Recommendation**: Once SEC-07 is patched (add `requireAdmin`), add: `test('returns 401 when not logged in', ...)`.

---

### TEST-04 — Severity: Critical
**Anonymous Survey Submission Lacks Payload Validation Tests**

`results.test.js` tests that anonymous submission returns `200`, but does not test: oversized `surveyResult` payload, malformed JSON, or missing `postId`. The route writes directly to DB without size/schema guards.

**Recommendation**: Add a test with a 100 KB `surveyResult` and verify `400` or payload rejection via the `50kb` body limit.

---

### TEST-05 — Severity: High
**`csvLog` Route (5 Endpoints) Has Zero Test Coverage**

No `csvLog.test.js` exists anywhere. The 5 endpoints include `DELETE …/with-data` which runs a manual `BEGIN/COMMIT` transaction. The rollback path on error has never been exercised. The service-level pure functions are well tested, but the route layer is dark.

**Recommendation**: Create `backend/tests/integration/routes/csvLog.test.js` covering: auth guard (401/403), successful upload → 201 with `csvNames`, mapping creation, and `with-data` delete rollback on DB error.

---

### TEST-06 — Severity: High
**`computeSRLClusterScores` (130 Lines) — 0% Coverage**

All `clusterPeerService.test.js` tests use `'lms'` concept, never `'srl'`. The SRL path has a distinct composite scoring formula and a `storeDiagnostics` call that does NOT apply the P-C1 sampling cap that was added for other concepts. A cohort of 200 SRL users would still compute full O(N²) silhouette scores — undetectable by current tests.

**Recommendation**: Add `computeClusterScores(null, 'srl', userId)` test cases with SRL-shaped metrics mocks covering: cold start, normal result, and `storeDiagnostics` fire-and-forget error non-propagation.

---

### TEST-07 — Severity: High
**`batchComputeClusterScores` and `batchScoreLMSCohort` Are Completely Untested**

Both batch scoring functions are exported but have no tests. `batchComputeClusterScores` runs a full `withTransaction` loop; `batchScoreLMSCohort` swallows per-user errors with `.catch()`. Neither path is exercised.

**Recommendation**: Unit tests for `batchComputeClusterScores` covering cold-start early return, happy path, and transaction rollback on `storeUserAssignment` failure.

---

### TEST-08 — Severity: High
**`register` Endpoint Has No Tests**

`auth.test.js` covers `POST /login`, `GET /me`, `POST /legacy-login` — but not `POST /register`. Key untested: 201 response with session cookie set, 409 on duplicate email, password length validation, `SIMULATION_MODE=false` skips `generateStudentData`, and simulation failure doesn't fail registration.

---

### TEST-09 — Severity: High
**`logout` Endpoint Has No Tests**

`authController.js` lines 51–62 — no test covers successful logout (200 `{}`), `session.destroy` error path (500), or that `clearCookie` fires.

---

### TEST-10 — Severity: Medium
**`scoreQueryService.js` Never Tested Directly**

`getConceptPoolSizes`, `getUserConceptDataSet`, `getClusterInfoByUser`, `getAllUserMetrics` are always mocked in consumer tests. The `EXCLUDE_SIMULATED_USERS` conditional (toggled by `SIMULATION_MODE=false`) is never exercised by any test.

---

### TEST-11 — Severity: Medium
**`storeDiagnostics` Error-Swallow Path Untested**

`clusterStorageService.test.js` covers 6 scenarios. The `storeDiagnostics` error-swallowing `try/catch` path (lines 100–124) — where the caller does not receive the thrown exception — is not tested.

---

### TEST-12 — Severity: Medium
**Legacy Severity-Based `computeAndStoreScore` Untested**

`conceptScoreService.js` `computeAndStoreScore` (legacy severity-based path using `severityToScore()`) has no test. If any annotator still calls this path, its behavior is unverified.

---

### TEST-13 — Severity: Medium
**Rate Limiter Never Fire-Tested for 429 Enforcement**

`health.test.js` only asserts `typeof authLimiter === 'function'`. No test fires repeated requests to verify 429 is actually returned after the threshold is reached.

---

### TEST-14 — Severity: Medium
**Chatbot Service Layer Has No Unit Tests**

`contextManagerService.js`, `promptAssemblerService.js`, and `summarizationService.js` are all mocked entirely in route tests. Complex branching logic (greeting staleness, session expiry, alignment checking) is only exercised end-to-end via the mock, not directly.

---

### TEST-15 — Severity: Medium
**`peerStatsService.js` Has No Test File**

No test file found. This service's exports and behavior are entirely untested.

---

### TEST-16 — Severity: Low
**`storeClusterResults` Assertions Are Too Shallow**

`clusterStorageService.test.js` asserts the query was called and checks the first SQL string. It does not assert the number of `INSERT INTO peer_clusters` calls (should equal `k`), parameter values, or that labels are correctly passed.

---

### TEST-17 — Severity: Low
**`calculateTrend` Not Tested for `NaN` / Non-Numeric Input**

`conceptScoreService.test.js` tests `null` and `undefined` history inputs but not `NaN` or string values from potential DB type coercion issues.

---

### TEST-18 — Severity: Low
**Test Pyramid Is Route-Heavy; Service Unit Tests Underrepresented**

17 of 28 test files are route-level integration tests using `supertest`. Zero unit tests exist for: `moodleService`, `moodleEventSimulator`, `simulationOrchestratorService`, `alignmentService`, `chatbotPreferencesService`, `apiConnectorService`. Route tests are brittle when route structures change and miss deep service branches.

---

### Pre-Existing Failures — Clarification

The three originally-noted pre-existing failures (`auth.test.js`, `admin.test.js`, `adminLlmConfig.test.js` at root) have been superseded by files in `backend/tests/integration/routes/`. However, `backend/tests/adminLlmConfig.test.js` mounts the admin router at `/admin` while production mounts it at `/api/admin` — a mount-path divergence that should be verified doesn't cause silent test-vs-production behavior mismatch.

---

## Documentation Findings

### DOC-01 — Severity: Critical
**`surveys.js` Router Has No Swagger Annotations**

All three endpoints (`GET /getActive`, `GET /getSurvey`, `POST /changeJson`) are undocumented. `POST /changeJson` has no auth guard in code — the Swagger annotation would have flagged this inconsistency immediately.

---

### DOC-02 — Severity: Critical
**`results.js` Router Has No Swagger Annotations**

`GET /results/today` and `POST /post` are undocumented. The `null`-userId fallback (anonymous submissions silently accepted) is not documented anywhere.

---

### DOC-03 — Severity: Critical (Functional Bug)
**Mood Router Is Never Mounted — Feature Is Silently Broken**

`backend/routes/mood.js` defines `GET /` and `GET /history` but is never imported or mounted in `routes/index.js`. The mood feature is completely unreachable at runtime. The README lists "MoodHistory" as a frontend component, implying the routes are expected to work.

**Immediate Fix**: Add to `routes/index.js`:
```js
import moodRoutes from './mood.js'
// …
router.use('/mood', moodRoutes)
```

---

### DOC-04 — Severity: High
**Multiple Admin Endpoints Lack Swagger Annotations**

Missing annotations on: `GET/PUT /admin/prompt`, `GET /admin/students/:studentId/annotations`, `GET /admin/cluster-diagnostics`, all 4 LLM config endpoints (`/llm-config`, `/llm-config/reveal-key`, `PUT /llm-config`, `POST /llm-config/test`), `DELETE /admin/clear-student-data`, `POST /admin/recompute-scores`, and both legacy `/system-prompt` routes. The destructive delete endpoint has no documentation at all.

---

### DOC-05 — Severity: High
**LMS Bulk Sync Async Pattern Undocumented in Swagger**

`POST /lms/admin/sync-all` returns `202 Accepted` and a `jobId` for polling, but has no `@swagger` annotation. The in-memory job store limitation (state lost on restart) is only in a code comment.

---

### DOC-06 — Severity: High
**Chat Router Missing Annotations for 6 Endpoints**

`GET /chat/initial`, `GET /chat/sessions`, `POST /chat/reset`, `GET /chat/status`, `GET/PUT /chat/preferences` have no `@swagger` blocks. `GET /chat/initial` is particularly complex — it returns two distinct response shapes depending on session state.

---

### DOC-07 — Severity: High
**`DEBUG_LLM`, `COOKIE_SECURE`, `EC2_HOST` Missing from `.env.example`**

- `DEBUG_LLM`: set `true` in `compose.yml`, not documented. Logs full LLM payloads (sensitive student data).
- `COOKIE_SECURE`: read in `server.js` for cookie security. Not setting it in HTTP deployments causes silent browser login failures.
- `EC2_HOST`: interpolated in `compose.http.yml` for `CORS_ORIGINS`. If unset, `CORS_ORIGINS=http://` and all CORS requests fail.

---

### DOC-08 — Severity: High (Functional Bug)
**`compose.yml` Passes `REACT_APP_API_BASE` but Dockerfile Expects `VITE_API_BASE`**

`compose.yml` line 9: `REACT_APP_API_BASE: "/api"`. `Dockerfile` declares `ARG VITE_API_BASE`. The CRA build arg name was never updated after the Vite migration. The arg is silently discarded — any deployment depending on it to set a custom API URL gets the Vite default instead.

**Immediate Fix**: Rename in `compose.yml`:
```yaml
VITE_API_BASE: "/api"
```

---

### DOC-09 — Severity: High
**Deployment Runbook Inaccurate: "4 Services" When Only 3 Exist**

`docs/runbooks/deployment.md` says "Verify all 4 services are running" but `compose.yml` defines only 3 (`web`, `backend`, `postgres`).

---

### DOC-10 — Severity: Medium
**Sleep and Screen-Time Routes Have No Swagger Annotations**

`POST /sleep` has non-trivial business logic (midnight crossing, interval sorting, upsert semantics) with no `@swagger` documentation. Same for `GET /sleep/today`, `POST /screen-time`, `GET /screen-time/today`.

---

### DOC-11 — Severity: Medium
**Profile Routes Have No Swagger Annotations**

`GET /profile`, `PUT /profile`, `POST /profile/onboarding-complete` are undocumented. The `PUT /profile` upsert semantics and the `GET /profile` 404 case should be explicit.

---

### DOC-12 — Severity: Medium
**`GET /scores/:conceptId` Has No Swagger Annotation**

Only `GET /scores/` is annotated. The single-concept endpoint is missing its annotation, including the `conceptId` path parameter and the `404` response.

---

### DOC-13 — Severity: Medium
**CSV Log Routes Are Entirely Undocumented**

All 7 `csvLog.js` endpoints have no `@swagger` blocks. The two-phase upload → import workflow and the `X-Filename` header are undiscoverable from the API spec.

---

### DOC-14 — Severity: Medium
**README References `npm start` and Port 3000 Post-Vite Migration**

`npm start` is a CRA command; Vite's dev command is `npm run dev`, default port `5173`. The README "Local Development" section needs updating.

---

### DOC-15 — Severity: Medium
**`DATABASE_URL` in `.env.example` Points to `localhost:5433` — Wrong Inside Docker**

The env example entry will not work inside Docker containers where the host should be `postgres:5432`. Misleads developers setting up from scratch with Docker.

---

### DOC-16 — Severity: Medium
**Postgres Major-Version Volume Incompatibility Not Documented**

`compose.yml` uses `postgres:18`. Upgrading to a new major version requires `docker compose down -v`. This critical caveat exists only as a compose.yml comment — not in any runbook.

---

### DOC-17 — Severity: Medium
**`/annotations/chatbot` Endpoint Not Annotated**

The chatbot-formatted annotations endpoint returns a plain-text blob, not structured JSON. Its response shape and purpose are not documented in Swagger.

---

### DOC-18 — Severity: Low
**Cron Job Failure Has No Troubleshooting Entry**

`troubleshooting.md` covers cold-start and manual recomputation but not the failure path where `concept_scores` goes stale because the cron didn't run. No instructions for checking `computed_at` timestamps or verifying the cron scheduled correctly.

---

### DOC-19 — Severity: Low
**Legacy `/api/logout` and `/api/me` Aliases Undocumented**

These routes shadow the canonical `/api/auth/*` routes but do not appear in the generated Swagger spec.

---

### DOC-20 — Severity: Low
**`/legacy-login` Security Risk Not Documented**

No inline comment warns about the admin session bypass, and no runbook or README mentions it is intentionally dev-only.

