# Phase 1: Code Quality & Architecture Review

_Review date: 2026-03-11. Based on commits `04eaee5` and `d524dc2`._

---

## Code Quality Findings

### CQ-01 — Severity: High
**`signSessionId()` Re-implements `cookie-signature` From Scratch**

`authController.js` lines 11–14 hand-roll the HMAC-SHA256 base64url signing algorithm that `cookie-signature` (express-session's direct dependency) uses:
```js
function signSessionId(id, secret) {
    const sig = createHmac('sha256', secret).update(id).digest('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return 's:' + id + '.' + sig
}
```
This is fragile: if `cookie-signature` changes its output format in a future semver update, this function silently produces wrong cookies and every session becomes invalid on the next deploy. The duplication is intentional (the comment explains a session.save() race condition), but the correct fix is to import and call `cookieSignature.sign()` directly.

**Recommendation**: `import cookieSignature from 'cookie-signature'` and use `cookieSignature.sign(sessionId, secret)`. The `cookie-signature` package is already a transitive dependency via `express-session`.

---

### CQ-02 — Severity: Medium
**`session.save()` + `setSessionCookie()` Pattern Duplicated in Login and Register**

Both `login` and `register` in `authController.js` execute the same three-line sequence:
```js
await new Promise((resolve, reject) =>
    req.session.save(err => (err ? reject(err) : resolve()))
)
setSessionCookie(res, req.sessionID)
```
Any future change (adding a new cookie attribute, changing the save mechanism) must be made in two places.

**Recommendation**: Extract a `saveSessionAndRespond(req, res, user, statusCode=200)` helper that handles save → cookie → JSON response, and call it from both handlers.

---

### CQ-03 — Severity: Medium
**`/legacy-login` Route Creates Fake Session Objects Without a Real DB User**

`auth.js` lines 133–147: the fallback `legacy-login` path sets `req.session.user = { id: 'demo-user', role }` without a real DB row. Any downstream route that looks up `user_id` in the database using this fake UUID will get either an empty result set or a foreign key violation. The route lacks `await req.session.save()` after setting the session.

**Recommendation**: Either remove this route entirely (it's blocked in production), or at minimum add `await req.session.save()` and document the exact scenario where it is needed. A test-only fake login mechanism should use the real test account credentials.

---

### CQ-04 — Severity: Medium
**`batchComputeClusterScores` Inlines Category Logic Instead of Calling `_mapDomainCategory`**

`clusterPeerService.js` lines 526–531 duplicate the exact threshold comparison that `_mapDomainCategory()` encapsulates:
```js
category: ds.score >= SCORE_THRESHOLDS.VERY_GOOD ? 'very_good'
        : ds.score >= SCORE_THRESHOLDS.GOOD ? 'good'
        : 'requires_improvement',
categoryLabel: ds.score >= SCORE_THRESHOLDS.VERY_GOOD ? 'Very Good' ...
```
The `_mapDomainCategory` helper was extracted precisely to prevent this. If thresholds change, the batch path will diverge silently.

**Recommendation**: Replace the inline ternary with `const { category, categoryLabel } = _mapDomainCategory(ds.score)`.

---

### CQ-05 — Severity: Medium
**`computeCompositeScore` Re-sorts the Full `allValues` Array on Every Call**

`clusterPeerService.js` line 91:
```js
const allValues = Object.values(allMetrics).map(m => m[def.metric])
    .filter(v => v != null).sort((a, b) => a - b);
```
`computeCompositeScore` is called once per user in `batchComputeClusterScores` (N users × D dimensions), but it re-derives the P5/P95 ranges from scratch each time. `_runConceptClustering` already pre-computes `ranges` and caches them. The batch path calls `computeCompositeScore` independently, paying O(N log N) sort cost N×D times.

**Recommendation**: Add a `precomputedRanges?` optional parameter to `computeCompositeScore` so the batch path can pass the already-computed ranges. This is a correctness issue as well as a performance one: the two code paths may derive slightly different P5/P95 values from the same data depending on floating-point ordering.

---

### CQ-06 — Severity: Low
**Active-User UNION Query Duplicated in `cronService.js` and `admin.js`**

The 4-table `UNION` query that collects distinct active user IDs exists in:
- `cronService.js` lines 30–47
- `admin.js` (`/recompute-scores` route) lines 419–430 (slightly different — no 30-day window)

Any schema change to the activity tables (adding an `is_simulated` column to `srl_responses`, for example) must be made in both places.

**Recommendation**: Move the active-user query into `scoreQueryService.js` as an exported `getActiveUserIds(windowDays?)` function and call it from both places.

---

### CQ-07 — Severity: Low
**`DURATION_THRESHOLDS.long` Is Dead Code in `sleepAnnotationService.js`**

```js
const DURATION_THRESHOLDS = {
    very_low: 0.75,
    low: 0.90,
    sufficient: 1.10,
    long: 1.10    // ← same value as 'sufficient', never referenced
};
```
`evaluateDuration` checks `< very_low`, `< low`, `<= sufficient`, then falls through to an implicit "long sleep" return. The `long` key is never used. Its presence and identical value to `sufficient` is confusing — it looks like a configuration option that has no effect.

**Recommendation**: Remove the `long` key from `DURATION_THRESHOLDS` and add a comment to the final fallback return: `// ratio > sufficient — long sleep`.

---

### CQ-08 — Severity: Low
**`evaluateDistribution` Default Fallback Is Silent and Over-broad**

`lmsAnnotationService.js` lines 116–122: the function returns `dist_spread` as a default for any case that doesn't match condensed, spread, or fragmented. This makes it impossible to tell from logs or tests which real inputs hit the fallback vs. the explicit `spread` branch.

**Recommendation**: Add an `else if` guard with a comment explaining the default semantics, and log a `debug` message when the fallback fires so unexpected cases are observable.

---

### CQ-09 — Severity: Low
**`apiLimiter` Admin Skip Applies Across All `/api` Routes**

`rateLimit.js` line 11:
```js
skip: (req) => req.session?.user?.role === 'admin'
```
Admin role entirely bypasses the API rate limiter for every endpoint, including potentially expensive ones like `/recompute-scores` or `/cluster-members`. A compromised admin account has unrestricted throughput against the backend.

**Recommendation**: Remove the blanket skip, or narrow it to specific informational endpoints. The admin recompute trigger is the most dangerous unthrottled route.

---

### CQ-10 — Severity: Medium
**`computeConceptScore` Silently Returns `null` on Any Error**

`scoreComputationService.js` lines 65–68: the entire concept scoring computation is wrapped in `try/catch` that returns `null` on failure. This is architecturally significant (see AR-11) but also a code quality issue — `null` is also returned for "no data" cases, conflating two very different outcomes in the caller.

**Recommendation**: Return a discriminated object `{ status: 'error' | 'no_data' | 'cold_start' | 'ok', result }` so callers can react differently to genuine errors vs. expected empty states.

---

### CQ-11 — Severity: Low
**Magic Number `10` (MIN_CLUSTER_USERS) Defined in Three Places**

`MIN_CLUSTER_USERS = 10` appears in:
- `clusterPeerService.js` (line 179, as a `const`)
- `admin.js` (line 234, inline)
- `scores.js` (line 103, inline)

The admin and scores routes use the literal `10` while the service uses the named constant. If the threshold changes, the routes will silently use the old value.

**Recommendation**: Export `MIN_CLUSTER_USERS` from `clusterPeerService.js` (or `constants.js`) and import it in both route files.

---

## Architecture Findings

_(See `.full-review/01-architecture.md` for full details. Key findings summarised below.)_

### AR-02 — Severity: High
**`batchComputeClusterScores` Bypasses Extracted Private Helpers**

The `_persistClusterResults` and `_computeUserPercentile` helpers were extracted but `batchComputeClusterScores` reimplements the same patterns inline (transaction block + per-user `mapToRange` call). Partial refactor leaves inconsistency.

---

### AR-06 — Severity: High
**`server.js` Imports from a Route Module (`routes/surveys.js`)**

`import { ensureFixedSurvey } from './routes/surveys.js'` violates the infrastructure→service→route dependency direction.

---

### AR-11 — Severity: High
**Silent `null` Return Hides Scoring Errors**

`computeConceptScore` catches all errors and returns `null`, making failures indistinguishable from "no data". The cron and manual recompute callers have no way to detect or count scoring failures.

---

### AR-03 — Severity: Medium
**`SIMULATION_MODE` Frozen at Module Load Time**

`scoreQueryService.js` evaluates `SIMULATION_MODE` at import, breaking test isolation and making runtime changes ineffective.

---

### AR-05 — Severity: Medium
**Score-Mapping Loop Still Duplicated Between `admin.js` and `scores.js`**

`getClusterInfoByUser` was extracted but the ~25-line response-object construction loop was not. Both routes build the same shape independently.

---

### AR-09 — Severity: Medium
**`contextManagerService.js` Mixes 6+ Distinct Concerns**

Session lifecycle, message persistence, greeting generation, AI orchestration, alignment checking, and summarisation invalidation all live in one file.

---

## Critical Issues for Phase 2 Context

The following findings from Phase 1 should directly inform the security and performance review:

1. **CQ-01 / Auth**: `signSessionId()` reimplements `cookie-signature` — any subtle divergence from the library's output is an authentication bypass.
2. **CQ-03 / Auth**: `/legacy-login` creates fake session objects with `id: 'demo-user'` — if reachable in non-production environments used as staging, this is a broken access control path.
3. **CQ-09 / Rate limiting**: Admin skip on all API rate limiting — admin accounts are unrestricted.
4. **AR-11 / Observability**: Silent null from scoring errors means security-relevant failures (e.g., DB errors triggered by injection attempts) produce no visible signal.
5. **AR-03 / Config**: Module-load env vars mean SIMULATION_MODE changes are invisible at runtime — relevant if toggling between real and simulated users affects data isolation.
6. **CQ-05 / Performance**: `computeCompositeScore` re-sorts N×D arrays on every batch invocation — O(N²D log N) in the batch path.
7. **AR-06 / Coupling**: Server bootstrap importing from a route module means any future route-level change (middleware addition, auth guard) could accidentally affect startup.
