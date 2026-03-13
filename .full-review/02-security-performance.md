# Phase 2: Security & Performance Review

_Review date: 2026-03-11._

---

## Security Findings

### SEC-01 — Severity: Critical (CVSS 9.1) | CWE-347
**Hand-Rolled Session Cookie Signing**

`authController.js` lines 11–15 re-implements `cookie-signature`'s HMAC-SHA256 signing with manual base64url substitution (`.replace(/\+/g, '-')`, `.replace(/\//g, '_')`). The `cookie-signature` library does NOT perform these substitutions — it uses plain base64 with only `=` padding stripped. The hand-rolled function produces a different signature than what `express-session` generates, meaning the manual override is the canonical signing path. Any subtle divergence from the library's format risks authentication bypass or universal session forgery given knowledge of the session secret.

**Remediation**: `import { sign } from 'cookie-signature'` and replace the manual function with `'s:' + sign(id, secret)`. Investigate whether the root cause (nginx not firing `res.end()` hook) still applies — the explicit `session.save()` await may have already resolved it, making the manual override unnecessary.

---

### SEC-02 — Severity: Critical (CVSS 9.0) | CWE-319
**Plaintext HTTP Deployment with Session Cookies**

Production runs on port 80 (`compose.http.yml`) with `COOKIE_SECURE=false` and HSTS explicitly disabled. Session cookies with full auth credentials are transmitted in cleartext, enabling passive network sniffing on any shared network (university campus Wi-Fi is the primary deployment environment).

**Remediation**: Add TLS termination via AWS ALB, Cloudflare tunnel, or nginx + Let's Encrypt. Set `COOKIE_SECURE=true`, re-enable HSTS (`max-age: 31536000`), and re-enable `upgrade-insecure-requests` CSP directive.

---

### SEC-03 — Severity: High (CVSS 8.1) | CWE-287
**Legacy Login Creates Arbitrary Admin Sessions From User Input**

`auth.js` lines 133–147: the `/legacy-login` endpoint accepts `req.body.role` directly and sets `req.session.user = { id: 'demo-user', role }`. The only guard is `NODE_ENV === 'production'`, but `NODE_ENV` defaults to `'development'` when unset (per `envValidation.js`). Any unauthenticated request to `POST /api/auth/legacy-login` with `{ "role": "admin" }` on a non-explicitly-configured production server grants full admin privileges including data deletion and API key reveal.

**Remediation**: Remove `/legacy-login` entirely. If needed for development, guard with an explicit `ENABLE_DEMO_LOGIN=true` env var and fix the hardcoded `'demo-user'` ID which breaks any downstream user lookups.

---

### SEC-04 — Severity: High (CVSS 7.5) | CWE-770
**Admin Role Bypasses All API Rate Limiting**

`rateLimit.js` line 11: `skip: (req) => req.session?.user?.role === 'admin'`. Combined with SEC-03, a compromised or forged admin session has zero rate limiting across all endpoints including expensive ones: `/admin/recompute-scores` (full DB scan + PGMoE for all users), `/chat/message` (LLM API call), and Moodle sync endpoints (unbounded external HTTP calls).

**Remediation**: Replace the blanket skip with a higher per-admin limit (e.g., 2000 req/15min) instead of no limit.

---

### SEC-05 — Severity: High (CVSS 7.5) | CWE-312
**LLM API Key Stored in Plaintext in Database**

The `llm_config` table stores `api_key` in plaintext (`admin.js` line 512). Any database read access (backup, log, or future injection) exposes the LLM provider key. The `/admin/llm-config/reveal-key` endpoint returns it verbatim.

**Remediation**: Encrypt at rest using envelope encryption or move to a secrets manager. Redact from all logs. At minimum, add a note to the `reveal-key` endpoint's audit log.

---

### SEC-06 — Severity: High (CVSS 7.2) | CWE-918
**SSRF via Admin-Controlled LLM Base URL**

`admin.js` lines 544–576: the `/llm-config/test` endpoint makes an HTTP GET to `${resolvedBaseUrl}/models`. Validation is only `new URL(resolvedBaseUrl)`, which accepts `http://169.254.169.254/latest/meta-data/` (AWS instance metadata), `http://localhost:5432` (PostgreSQL), and any internal service. The response body is returned to the client, enabling full read SSRF.

**Remediation**: Block private IP ranges and cloud metadata addresses at URL parse time. Maintain an allowlist of permitted URL schemes (HTTPS only) and — if the LLM service is always a known provider — consider a domain allowlist.

---

### SEC-07 — Severity: Medium (CVSS 6.5) | CWE-862
**Survey Modification Without Authentication**

`surveys.js` has no `requireAuth` or `requireAdmin` guard. The `POST /api/changeJson` endpoint (line 93) allows unauthenticated modification of survey JSON, including potential XSS injection into survey titles rendered by the React frontend.

**Remediation**: Add `requireAdmin` to the `/changeJson` route. Consider `requireAuth` for all survey reads.

---

### SEC-08 — Severity: Medium (CVSS 5.3) | CWE-862
**Survey Result Submission Accepts Unauthenticated Requests**

`results.js` `POST /api/post` falls back to `userId = null` for unauthenticated submissions, inserting rows with `user_id = null`. This allows DB pollution with fake results.

**Remediation**: Add `requireAuth` and throw `Errors.UNAUTHORIZED()` instead of using `null` fallback.

---

### SEC-09 — Severity: Medium (CVSS 5.5) | CWE-598
**Moodle Token Passed as URL Query Parameter**

`moodleService.js` passes `wstoken=<token>` in GET URL query strings by Moodle REST convention. The token appears in server logs if request URLs are logged at debug level, and in Moodle's own access logs.

**Remediation**: Ensure the constructed URL is never logged verbatim. Use POST requests where possible. Rotate the Moodle token periodically.

---

### SEC-10 — Severity: Medium (CVSS 5.0) | CWE-532
**Debug LLM Logging Leaks Full Chat Payloads**

`apiConnectorService.js` lines 44–47: `if (DEBUG_LLM) console.log(JSON.stringify(requestBody))` dumps the full LLM request including all student messages and system prompts to stdout. No guard prevents this in production if `DEBUG_LLM=true` is accidentally set.

**Remediation**: Replace with `logger.debug(...)`, add `if (process.env.NODE_ENV === 'production') throw` or warn if `DEBUG_LLM=true` in production, and redact message content from debug logs.

---

### SEC-11 — Severity: Medium (CVSS 6.1) | CWE-798
**Hardcoded `'dev-secret'` Session Secret Fallback**

`server.js` line 103: falls back to `'dev-secret'` in non-production. All development/staging deployments share a predictable, publicly known session secret. Combined with SEC-02 (no TLS), anyone who knows `'dev-secret'` can forge sessions on staging.

**Remediation**: Generate a random secret at startup when not provided: `const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')`. Log a warning that sessions won't survive restarts.

---

### SEC-12 — Severity: Medium (CVSS 5.4) | CWE-352
**No CSRF Token Mechanism**

All state-changing endpoints rely solely on `SameSite=Lax`. This does not protect against attacks from subdomains or older browsers. No CSRF token is implemented.

**Remediation**: `SameSite=Lax` is adequate for this threat model, but document this as an accepted risk. Add `Origin` header validation on state-changing requests as defense in depth.

---

### SEC-13 — Severity: Low (CVSS 3.7) | CWE-20
**Missing Input Validation on Data Entry Endpoints**

`sleep.js`, `screen-time.js`, and `profile.js` lack express-validator rules. Sleep `start`/`end` strings are parsed with `.split(':').map(Number)` without format validation, potentially producing `NaN`. Screen time fields have no positivity constraints. Profile string fields have no length limits.

**Remediation**: Add express-validator rules to all data entry routes, consistent with the pattern in `auth.js`.

---

### SEC-14 — Severity: Low (CVSS 3.1) | CWE-209
**Raw Database Error Messages in Non-Production Error Responses**

`asyncRoute` maps non-AppError exceptions to `Errors.DB_ERROR(err.message)`, which stores the raw PostgreSQL error (containing table/column names, constraint names) in `details` and returns it to the client in non-production environments.

**Remediation**: Sanitize the `details` field even in non-production: strip PostgreSQL-specific error text, keeping only the generic message.

---

### SEC-15 — Severity: Low (CVSS 3.7) | CWE-307
**No Per-Account Login Lockout**

`authLimiter` applies 50 attempts per IP per 15 min. Distributed brute-force attacks from multiple IPs face no per-account lockout.

**Remediation**: Track failed login attempts per email in the database. After 10 consecutive failures, require CAPTCHA or add a temporary lock. This is low-priority given bcrypt's inherent slowness.

---

### SEC-16 — Severity: Low (CVSS 4.3) | CWE-862
**Unauthenticated Survey Reads and Redundant Legacy Auth Routes**

Survey GET endpoints (`/getActive`, `/getSurvey`) require no authentication. Legacy `/api/logout` and `/api/me` routes are unguarded aliases.

**Remediation**: Add `requireAuth` to survey reads. Remove legacy auth aliases.

---

### SEC-17 — Severity: Low (CVSS 2.4) | CWE-1021
**Dynamic Env Vars Injected Directly into CSP `connect-src`**

`server.js` lines 52–56 include `MOODLE_BASE_URL` and `LLM_BASE_URL` in the CSP policy without domain validation. A compromised env var could inject an attacker-controlled domain into the allowlist.

**Remediation**: Validate URL format/domain before including in CSP. Low priority given the env var compromise prerequisite.

---

## Performance Findings

### PERF-01 — Severity: Critical
**O(N²D log N) Composite Score Computation in Batch Path**

`clusterPeerService.js` lines 498–534: `batchComputeClusterScores` calls `computeCompositeScore(allMetrics[uid], allMetrics, dims)` inside a loop over N users. Inside `computeCompositeScore`, for each of D dimensions the entire `allValues` array is reconstructed and sorted (`O(N log N)`) on every call. Total: `O(N² × D × log N)` vs. optimal `O(N × D × log N)`. For 100 users and 4 dimensions: 40,000 sort operations vs. 400.

**Remediation**: Pre-compute sorted value arrays and P5/P95 ranges once in `_runConceptClustering` (they already exist in `ranges`), and pass them as a parameter to `computeCompositeScore`. Cache is already available — the batch path simply doesn't use it.

---

### PERF-02 — Severity: High
**Redundant Per-Cluster Filter+Sort for Every User in Batch Loop**

`clusterPeerService.js` lines 504–507: inside the N-user batch loop, `composites.filter(u => u.cluster === origCluster).sort(...)` runs N times. Cluster composition doesn't change within the loop. Total: `O(N² log N)` vs. `O(N log N)`.

**Remediation**: Pre-group composites by cluster index before the loop:
```js
const clustersByOrigIndex = {}
for (let c = 0; c < k; c++) {
    clustersByOrigIndex[c] = composites
        .filter(u => u.cluster === c).map(u => u.composite).sort((a, b) => a - b)
}
```
Then use `clustersByOrigIndex[origCluster]` inside the loop.

---

### PERF-03 — Severity: High
**PostgreSQL Connection Pool Uses All-Default Settings**

`config/database.js` creates a `Pool` with no explicit `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`, or `statement_timeout`. The `pg` default of 10 connections is undersized for concurrent scoring runs, Moodle syncs, and chat operations on t2.micro (1 GB RAM). No `statement_timeout` means a hung query blocks a connection indefinitely.

**Remediation**: Explicitly configure the pool:
```js
max: parseInt(process.env.DB_POOL_SIZE || '5'),  // conservative for t2.micro
idleTimeoutMillis: 30000,
connectionTimeoutMillis: 10000,
statement_timeout: 30000,
application_name: 'studentaid-backend'
```
Expose `DB_POOL_SIZE` in `.env.example`.

---

### PERF-04 — Severity: High
**Sequential User Scoring Loop in Nightly Cron**

`cronService.js` lines 59–67 processes users sequentially with `await computeAllScoresFn(user_id)`. With 100 users at ~2–3 s each (4 concepts × clustering), cron runtime is 3–5 minutes. `p-limit` is already in the dependency tree (used by `moodleService.js`).

**Remediation**: Import `pLimit` and run 3–5 users concurrently:
```js
const limit = pLimit(3)
await Promise.all(rows.map(({ user_id }) =>
    limit(() => computeAllScoresFn(user_id).catch(err => {
        logger.error(`Cron: failed for ${user_id}: ${err.message}`)
        errorCount++
    }))
))
```
Estimated 3–5× speedup. Note: `successCount`/`errorCount` tracking needs thread-safe increments (not truly threaded in Node, so `++` is safe).

---

### PERF-05 — Severity: High
**`_computeUserPercentile` Filters and Sorts Full Composites Array on Each Single-User Call**

`clusterPeerService.js` lines 136–146: called once per single-user scoring run, but re-sorts the cluster's composite array from scratch each time. In the single-user path (`computeClusterScores`) this is called after a full `_runConceptClustering` that already computed composites. The sort result is discarded after one use.

**Remediation**: Pass pre-sorted per-cluster arrays from `_runConceptClustering` to callers. Same fix as PERF-02 but for the single-user path.

---

### PERF-06 — Severity: High
**Missing Composite Indexes on Hot Query Paths**

Multiple high-frequency queries filter on combinations of columns that have no composite index:
- `lms_sessions(user_id, is_simulated, session_date)` — used in every scoring and pool-size query
- `sleep_sessions(user_id, is_simulated, session_date)` — same
- `screen_time_sessions(user_id, is_simulated, session_date)` — same
- `chat_sessions(user_id, is_active, created_at DESC)` — used on every chat message
- `concept_score_history(user_id, concept_id, score_date)` — used on every scores page load

Without composite indexes, every query does a sequential scan of the entire table.

**Remediation**: Add a migration:
```sql
CREATE INDEX idx_lms_sessions_scoring ON public.lms_sessions(user_id, is_simulated, session_date DESC);
CREATE INDEX idx_sleep_sessions_scoring ON public.sleep_sessions(user_id, is_simulated, session_date DESC);
CREATE INDEX idx_screent_sessions_scoring ON public.screen_time_sessions(user_id, is_simulated, session_date DESC);
CREATE INDEX idx_chat_sessions_active ON public.chat_sessions(user_id, is_active, created_at DESC);
CREATE INDEX idx_concept_score_history ON public.concept_score_history(user_id, concept_id, score_date DESC);
```

---

### PERF-07 — Severity: Medium
**Silent Null Returns Mask Scoring Failures — No Retry or Alerting**

`scoreComputationService.js` lines 65–68: errors are caught, logged, and `null` returned. `null` is indistinguishable from "no data". No retry is attempted, no metric is incremented, and the cron job's `successCount` is never decremented for the failed concept.

**Remediation**: Throw errors to the caller or return a discriminated `{ status: 'error' | 'no_data' | 'cold_start' }` object. Let the cron job count errors per concept, not just per user.

---

### PERF-08 — Severity: Medium
**3 Sequential DB Round-Trips on Every Chat Session Creation**

`contextManagerService.js` lines 27–65: `getOrCreateSession` makes three sequential queries (expire timed-out sessions → check for active session → update/insert). This adds 30–100 ms per chat message on network-latency DB connections.

**Remediation**: Consolidate into a single CTE query that expires stale sessions and returns or creates the active session in one round-trip.

---

### PERF-09 — Severity: Medium
**No Pagination on Chat Session History**

`contextManagerService.js` `getSessionHistory`: for users with 500+ messages, the query loads the full message history before `LIMIT`-ing. Large histories consume significant memory per request.

**Remediation**: Use keyset pagination (`WHERE id > $lastId ORDER BY id ASC LIMIT $n`) and return `hasMore` so the frontend can load older messages lazily.

---

### PERF-10 — Severity: Medium
**Moodle Forum Traversal Cap Is a Data-Loss Threshold, Not a Performance Guard**

`moodleService.js` line 25: `MAX_FORUM_DISCUSSIONS_PER_SYNC = 50`. For active courses with >50 forum discussions, posts beyond the first 50 are silently skipped on every sync. This is not an observable truncation — it is silent data loss.

**Remediation**: Track last-synced discussion ID per forum per user to resume from the correct position. Until then, document the cap explicitly in admin UI.

---

### PERF-11 — Severity: Low
**LLM Completion Retry Strategy Undocumented**

`apiConnectorService.js` `chatCompletionWithRetry`: retry logic is used throughout the chatbot pipeline but the backoff strategy is not verified. During LLM outages, unbounded or non-backoff retries could saturate the endpoint.

**Remediation**: Ensure exponential backoff with jitter and a hard maximum delay (≤2 s). Log retry attempts at `warn` level.

---

## Critical Issues for Phase 3 Context

1. **SEC-03** and **SEC-07/SEC-08**: Auth gaps on survey modification and result submission should drive test cases for unauthenticated access paths.
2. **SEC-01**: Cookie signing divergence — tests should verify that cookies issued by `authController` are accepted by `express-session`'s verify mechanism.
3. **PERF-06**: Missing DB indexes — no performance tests exist for scoring pipeline under realistic data volumes; this should be called out as a test gap.
4. **PERF-01/PERF-02**: Algorithm complexity regressions — the batch scoring path has no benchmarks. A test that validates O(N) scaling would catch this class of bug early.
5. **SEC-10**: LLM debug logging — should be tested that `DEBUG_LLM=true` in production emits a warning/error at startup.
