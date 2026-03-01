# Sprint 4 — Route Integration Test Coverage — Design

**Date:** 2026-03-01
**Goal:** Bring global line coverage from 57% to ≥70% by adding integration tests for the 4 zero-coverage route files.

---

## Context

After Sprint 3, the test suite has 142 passing tests but sits at 57.39% line coverage — below the 70% threshold in `jest.config.js`. The highest-impact untested files are all in `routes/`:

| File | Uncovered lines |
|---|---|
| `routes/mood.js` | 88 |
| `routes/lms.js` | 61 |
| `routes/results.js` | 18 |
| `routes/annotations.js` | 11 |

Covering these 4 files adds ~178 lines → ~71.5% coverage, clearing the threshold with margin.

---

## Architecture

Four new test files in `backend/tests/integration/routes/`, following the exact pattern established in `admin.test.js`:

- `jest.unstable_mockModule` for DB, logger, and service dependencies (ESM mock pattern)
- `await import(router)` after all mocks
- `buildApp(role)` helper: fresh Express app + `express-session` + session stub + router mounted
- `buildUnauthApp()` helper: no session (for 401 tests)
- `supertest` for HTTP assertions

**No new infrastructure** — same pattern, same test runner command, same jest config.

| New file | Route | Auth | Mocks needed |
|---|---|---|---|
| `mood.test.js` | `routes/mood.js` | `requireAuth` | `pool`, `logger` |
| `lms.test.js` | `routes/lms.js` | `requireAdmin` | `pool`, `logger`, `moodleService` |
| `results.test.js` | `routes/results.js` | none (userId nullable) | `pool`, `logger`, `srlAnnotationService`, `scoreComputationService` |
| `annotations.test.js` | `routes/annotations.js` | `requireAuth` | `pool`, `srlAnnotationService` |

`uuid` and `crypto.randomUUID` are **not** mocked — pure functions with no side effects. `p-limit` is **not** mocked — real limiter with mocked `syncUserFromMoodle` underneath.

---

## Test Scenarios

### `mood.test.js` (~12 tests)

**Auth:** 401 unauthenticated

**`GET /`:**
- 400 missing `surveyId`
- 400 invalid `period` value
- 404 survey not found
- 200 no questionnaire results → `{ hasData: false, totalResponses: 0 }`
- 200 with results → computed `average`, `min`, `max` per construct

**`GET /history`:**
- 400 missing `surveyId`
- 404 survey not found
- 200 `period=today` → time-bucketed chart points
- 200 `period=7days` → datetime-labelled chart points
- 200 no period → daily average buckets

---

### `lms.test.js` (~11 tests)

**Auth:** 401 unauthenticated, 403 student role

**`GET /admin/connection-status`:**
- Returns `{ connected: false, moodleConfigured: false }` when env vars absent
- Returns `{ connected: true, sitename, username }` when `verifyConnection` succeeds
- Returns `{ connected: false, error }` when `verifyConnection` throws

**`GET /admin/sync-status`:**
- Returns mapped student list from DB query

**`POST /admin/sync-all`:**
- 202 with `{ jobId, total, status: 'pending' }`

**`GET /admin/sync-all/status/:jobId`:**
- 200 returns job state for known jobId
- 404 for unknown jobId

**`POST /admin/sync/:userId`:**
- 404 when user not found in DB
- 200 returns sync result from `syncUserFromMoodle`

---

### `results.test.js` (~5 tests)

**`POST /post`:**
- 400 missing request body
- 400 missing `postId`
- 400 missing `surveyResult`
- 200 anonymous (no session → `userId = null` → skips SRL and score recomputation)
- 200 authenticated → calls `saveResponses`, `computeAnnotations`, fire-and-forget `computeAllScores`

---

### `annotations.test.js` (~4 tests)

**Auth:** 401 unauthenticated

**`GET /`:**
- 200 returns `{ annotations }` from `getAnnotations`

**`GET /chatbot`:**
- 200 returns `{ annotationsText }` from `getAnnotationsForChatbot`

---

## Mock Paths

From `backend/tests/integration/routes/` (3 levels up to backend root):

| Module | Mock path |
|---|---|
| `backend/config/database.js` | `'../../../config/database.js'` |
| `backend/utils/logger.js` | `'../../../utils/logger.js'` |
| `backend/services/moodleService.js` | `'../../../services/moodleService.js'` |
| `backend/services/annotators/srlAnnotationService.js` | `'../../../services/annotators/srlAnnotationService.js'` |
| `backend/services/scoring/scoreComputationService.js` | `'../../../services/scoring/scoreComputationService.js'` |

---

## Coverage Projection

| Scenario | Lines covered | Cumulative % |
|---|---|---|
| Baseline (Sprint 3) | 722 / 1258 | 57.39% |
| + mood.js | +88 | ~64.4% |
| + lms.js | +61 | ~69.2% |
| + results.js | +18 | ~70.6% |
| + annotations.js | +11 | **~71.5%** |

---

## Out of Scope

- `computeSRLClusterScores` path in `clusterPeerService.js` (Sprint 5 backlog)
- `peerStatsService.js` (0% coverage, 44 lines — Sprint 5 backlog)
- `scoreQueryService.js` deeper coverage (Sprint 5 backlog)
- Lowering the jest.config.js threshold (not needed — goal is to meet it)
