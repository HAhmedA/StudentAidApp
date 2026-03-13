# Phase 1B — Architecture & Design Review

_Reviewed against commit `04eaee5` (P1 fixes) and `d524dc2` (chatbot/gauges)._

---

## AR-01 — Severity: Medium
**Route Aggregator: Nameless `/` Mounts**

`routes/index.js` mounts `surveyRoutes` and `resultRoutes` directly at `/`:
```js
router.use('/', surveyRoutes)   // /api/create, /api/getActive …
router.use('/', resultRoutes)   // /api/results, /api/post …
```
These routes pre-date the namespaced layout. The implicit paths are hard to discover (nothing in `index.js` tells you what endpoints live there), and Express will execute both middleware chains for every non-matching request on `/api`.

**Recommendation**: Namespace both routers explicitly (`/surveys`, `/results`) and update any frontend callers that still use the old paths. If backward compat is needed, add explicit aliases rather than naked `/` mounts.

---

## AR-02 — Severity: High
**`batchComputeClusterScores` Bypasses `_persistClusterResults` Helper**

`_persistClusterResults` was extracted to centralise the transaction + store calls, but `batchComputeClusterScores` (line 495–516) re-implements the same pattern inline:

```js
await withTransaction(pool, async (client) => {
    await storeClusterResults(...)
    for (...) { await storeUserAssignment(...) }   // inline loop
})
```

Meanwhile `computeClusterScores` calls `_persistClusterResults`, and the per-user percentile in the batch loop re-implements the `mapToRange` call that `_computeUserPercentile` already encapsulates. The refactor only partially applied the extracted helpers.

**Recommendation**: Either extend `_persistClusterResults` to accept an optional array of users for the batch path, or make `batchComputeClusterScores` call `_computeUserPercentile` per user and then a single batch-aware persist helper. Keeps the invariant that percentile logic lives in one place.

---

## AR-03 — Severity: Medium
**`SIMULATION_MODE` Evaluated at Module Load Time**

`scoreQueryService.js` (line 9–11):
```js
const EXCLUDE_SIMULATED_USERS = process.env.SIMULATION_MODE === 'false'
    ? `AND user_id NOT IN ...`
    : '';
```
This constant is set once when the module first imports. Changing `SIMULATION_MODE` after server start has no effect, and test suites that set the env variable after the module is loaded will silently get stale behaviour.

**Recommendation**: Read `process.env.SIMULATION_MODE` inside each query function call site (or lazy-evaluate via an inline ternary in the SQL string). This makes tests reliable and the runtime behaviour explicit.

---

## AR-04 — Severity: Low
**`computeClusterScores` Accepts an Unused `dbPool` Parameter**

```js
async function computeClusterScores(dbPool, conceptId, userId, days = 7) {
    // dbPool is never used — we use the module-level `pool` import
```
The JSDoc confirms: `"@param {Object} dbPool - Database pool (unused, we use imported pool)"`. The parameter still sits at position 1, meaning callers must pass a throwaway value, and the DI contract advertised by the signature is a lie.

**Recommendation**: Either remove the parameter and use the module import consistently, or actually thread `dbPool` through to all internal calls (enabling proper DI for testing). The mixed approach is worse than either extreme.

---

## AR-05 — Severity: Medium
**Residual Score-Mapping Duplication Between `admin.js` and `scores.js`**

`getClusterInfoByUser` was correctly extracted into `scoreQueryService.js`. However the ~25-line score-mapping loop that follows it is still copy-pasted identically in:

- `backend/routes/scores.js` lines 112–131
- `backend/routes/admin.js` lines 213–230

Both construct the same response shape: `{ conceptId, conceptName, score, trend, breakdown, yesterdayScore, clusterLabel, clusterIndex, totalClusters, percentilePosition, clusterUserCount, dialMin, dialCenter, dialMax, computedAt, coldStart }`.

**Recommendation**: Extract a `mapScoreRow(row, clusterInfo, yesterdayScores, yesterdayBreakdowns?)` helper (into `scoreQueryService.js` or a new `scoreResponseMapper.js`) and call it from both routes. This ensures the response shape stays in sync when new fields are added.

---

## AR-06 — Severity: High
**Server Bootstrap Imports from a Route Module**

`server.js` line 12:
```js
import { ensureFixedSurvey } from './routes/surveys.js'
```
A core startup file reaches into a **route** module to call an initialisation function. This violates the dependency direction: infrastructure → services → routes; routes should not be sources of startup logic. Any change to `surveys.js`'s module boundary directly affects the server entry point.

**Recommendation**: Move `ensureFixedSurvey` into a dedicated service (e.g. `services/surveyService.js`) and import it from there. The route module should import from the service, not the other way around.

---

## AR-07 — Severity: Low
**Dual Router Mount at `/lms`**

```js
router.use('/lms', lmsRoutes)
router.use('/lms', csvLogRoutes)
```
Two separate routers share the same prefix. While Express handles this correctly (first match wins per router), it makes the full LMS API surface invisible from `index.js`. A developer reading the file cannot easily tell what endpoints are registered under `/lms`.

**Recommendation**: Merge `csvLogRoutes` into `lmsRoutes`, or mount `csvLogRoutes` under `/lms/csv` with an explicit sub-path.

---

## AR-08 — Severity: Low
**Undocumented Legacy Auth Routes at Root Level**

`routes/index.js` exposes:
```js
router.post('/logout', logout)
router.get('/me', getMe)
```
These duplicate `/auth/logout` and `/auth/me`. They are not Swagger-annotated and create a shadow API surface. If the canonical routes move or change behaviour, the legacy aliases silently diverge.

**Recommendation**: Add a deprecation note in the Swagger docs (or add stubs that return 410 Gone). At minimum, add JSDoc Swagger annotations so these routes appear in API docs alongside a deprecation warning.

---

## AR-09 — Severity: Medium
**`contextManagerService.js` — Oversized Service with Mixed Responsibilities**

The service manages: session lifecycle, message persistence, AI prompt assembly, AI call orchestration, alignment checking, and greeting generation. These are distinct concerns and the file is the largest single service. It directly calls `assemblePrompt`, `getAlignedResponse`, `chatCompletionWithRetry`, `hasSRLData`, `isGreetingStale`, `invalidateSummary` — six upstream dependencies.

This tight coupling makes testing the session lifecycle in isolation impossible without mocking the entire AI stack.

**Recommendation**: Extract a `chatOrchestrationService.js` that handles AI-specific concerns (prompt assembly → LLM call → alignment → persist). `contextManagerService.js` retains only session CRUD. The route calls orchestration directly, not the session manager.

---

## AR-10 — Severity: Low
**`getScoresForChatbot` — Unnecessary Indirection Layer**

`scoreComputationService.js`:
```js
async function getScoresForChatbot(userId) {
    return getAllScoresForChatbot(userId)   // passthrough
}
```
This function is a one-liner with no added logic, exported only to be called by chat routes via `scoreComputationService`. It adds an import hop with no benefit.

**Recommendation**: Remove the passthrough and have callers import `getAllScoresForChatbot` directly from `conceptScoreService.js`, or re-export it from `scoring/index.js`.

---

## AR-11 — Severity: High
**Silent Error Swallowing in `computeConceptScore`**

```js
try {
    // ... compute score ...
    return result
} catch (err) {
    logger.error(`Error computing ${conceptId} score: ${err.message}`)
    return null   // ← hides errors from the caller
}
```
A `null` return is indistinguishable from "no data for this concept". The cron job and manual recompute both call `computeAllScores` which silently drops failed concepts. This means a broken DB query, a schema migration issue, or a bug in an annotation service causes scores to silently not update — with no observable signal to the caller.

**Recommendation**: Let the error propagate (remove the catch in `computeConceptScore`), and handle partial failure at the `computeAllScores` level where the error can be counted and surfaced in the response. `cronService.js` already does this correctly for the user-level loop.

---

## AR-12 — Severity: Medium
**Score API Response Has No Versioning or Content-Type Negotiation**

All API routes return flat JSON without any versioning envelope. As the score response shape grows (e.g. `previousBreakdown` was recently added), frontend clients reading the old shape break silently. There is no `version` field, no `Accept: application/vnd.api+json` negotiation, and no API version prefix (`/api/v1`).

**Recommendation**: At minimum, add a `apiVersion: 1` field to score responses so clients can detect when the shape changes. Long-term, consider `/api/v2` prefix when breaking changes occur.

---

## Summary Table

| ID     | Severity | Area                        | Description |
|--------|----------|-----------------------------|-------------|
| AR-01  | Medium   | Routing                     | Nameless `/` mounts hide API surface |
| AR-02  | High     | Scoring pipeline            | Batch path bypasses extracted helpers |
| AR-03  | Medium   | Config / testability        | SIMULATION_MODE frozen at import time |
| AR-04  | Low      | DI / API contracts          | Unused `dbPool` parameter is misleading |
| AR-05  | Medium   | Code structure              | Score mapping loop still duplicated |
| AR-06  | High     | Layer separation            | server.js imports from a route module |
| AR-07  | Low      | Routing                     | Dual `/lms` mount obscures surface |
| AR-08  | Low      | API surface                 | Legacy auth aliases undocumented |
| AR-09  | Medium   | Service design              | contextManagerService over-coupled |
| AR-10  | Low      | Code structure              | Passthrough function adds no value |
| AR-11  | High     | Error handling architecture | Silent null return hides scoring errors |
| AR-12  | Medium   | API design                  | No response versioning strategy |
