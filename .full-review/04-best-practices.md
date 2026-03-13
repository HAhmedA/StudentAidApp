# Phase 4: Best Practices & Standards

_Review date: 2026-03-11._

---

## Framework & Language Findings

### BP-01 — Severity: Medium
**`app._sentryErrorHandler` Monkey-Patches the Express Application Object**

`server.js` stashes the Sentry handler on a custom property of the Express `app` instance (`app._sentryErrorHandler`). Writing arbitrary properties to a framework object is fragile: it will fail TypeScript strict mode if types are ever added, and the control flow is split across two distant code blocks.

**Recommendation**: Use a module-scoped variable:
```js
let sentryErrorHandler = null
if (process.env.SENTRY_DSN) { … sentryErrorHandler = Sentry.Handlers.errorHandler() }
if (sentryErrorHandler) app.use(sentryErrorHandler)
```

---

### BP-02 — Severity: Medium
**Startup Awaits Inside `app.listen` Callback; No `unhandledRejection` Handler**

`server.js` runs `initializeSystemPrompt`, `ensureFixedSurvey`, and `seedTestAccountData` inside an `async () => {}` listen callback. The server accepts connections while seeding is in progress. Errors inside the async callback that escape the per-block `try/catch` propagate to Node's default unhandled-rejection handler with no explicit recovery. The project has `"type": "module"` — true top-level await is available.

**Recommendation**: Await startup work at the top level; add a global handler:
```js
process.on('unhandledRejection', (reason) => { logger.error('Unhandled rejection:', reason); process.exit(1) })
await new Promise(resolve => app.listen(PORT, resolve))
await initializeSystemPrompt()
// …
startCronJobs()
```

---

### BP-03 — Severity: Medium
**DB Pool Has No `max`/Timeout Configuration**

`config/database.js` creates `new Pool(…)` with no explicit `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`, or `statement_timeout`. The default `max: 10` on a t2.micro with PGMoE batch operations that hold multiple clients simultaneously can silently queue or timeout (cross-references PERF-03).

**Recommendation**:
```js
const pool = new Pool({
    …,
    max: Number(process.env.PG_POOL_MAX) || 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
})
```

---

### BP-04 — Severity: Medium
**`asyncRoute` Recasts All Non-`AppError` Throws as Misleading `DB_ERROR`**

`errors.js` line 39: `err instanceof AppError ? err : Errors.DB_ERROR(err.message)`. A `TypeError`, network error, or validation library exception always surfaces as `DB_ERROR` HTTP 500, making triage and client-side error handling worse.

**Recommendation**: Preserve the original class name in the log message and use a more general `INTERNAL_ERROR` code for non-AppError exceptions.

---

### BP-05 — Severity: Medium
**`asyncRoute` Never Calls `next(err)` — Global Error Handler and Sentry Are Dead Code**

`asyncRoute` catches all errors and writes a JSON response directly, bypassing the Express error-handler chain. This means:
- The global error handler in `server.js` (lines 137–143) is never reached
- The Sentry error handler registered in `server.js` never receives route errors
- Every route error is handled by `asyncRoute`'s private JSON logic, not the centralized handler

**Recommendation**: Either call `next(err)` from `asyncRoute` and let the central handler format the response, or explicitly invoke Sentry inside `asyncRoute`. Migrating to Express 5 (BP-11) resolves this automatically via native async error propagation.

---

### BP-06 — Severity: Low
**`__filename`/`__dirname` Shims Are Redundant on Node ≥ 21.2**

`logger.js` and several service files use the 4-line `fileURLToPath` / `path.dirname` shim. Node 21.2 introduced `import.meta.dirname` and `import.meta.filename` as first-class ESM equivalents.

**Recommendation**: Replace with `import.meta.dirname` on Node ≥ 21. Add `"engines": { "node": ">=20" }` to `package.json` to document the minimum version.

---

### BP-07 — Severity: Low
**`parseInt` Without Radix in Query-Param Parsing**

`chat.js` line 164: `parseInt(limit)` without a radix. For numeric query params, `Number()` is idiomatic, avoids the octal edge case, and is consistent with how the pg driver already returns numeric string values.

**Recommendation**: Replace with `Number(limit) || 20`.

---

### BP-08 — Severity: Low
**Fire-and-Forget `.catch()` Pattern Repeated ~8 Times Without a Shared Utility**

`computeAllScores(userId).catch(err => logger.error(…))` appears identically across sleep, screen-time, results, csvLog, and moodleService routes. Adding structured logging or Sentry capture to all fire-and-forget paths requires editing 8+ call sites.

**Recommendation**: Extract `fireAndForget(promise, label)` to `utils/fireAndForget.js`.

---

### BP-09 — Severity: Low
**Synchronous PGMoE Model Selection Loop Blocks the Event Loop**

`pgmoeAlgorithm.js`: `selectOptimalModel` runs up to 20 synchronous EM fits (4 cov types × 5 K values) with no yielding. During a user-triggered score recompute, this can block the HTTP event loop for hundreds of milliseconds.

**Recommendation**: Yield between model fits with `await setImmediatePromise()`, or move to a `worker_threads` worker for CPU-bound computation.

---

### BP-10 — Severity: Low
**`surveyRoutes` and `resultRoutes` Mounted at `/` — Silent Collision Risk**

`routes/index.js` lines 27–29 mount two routers at the root namespace. Any route naming conflict silently resolves to whichever was mounted first. The routing table is opaque to code reviewers.

**Recommendation**: Namespace explicitly (`/surveys`, `/results`) or add a comment listing all paths exported by each router.

---

### BP-11 — Severity: Low
**`express` v4 and `uuid` v9 Are Superseded by Stable Releases**

`express` v5.1.0 is stable (released Oct 2024). Express 5 natively propagates rejected async route handler promises to the error-handler chain, making the entire `asyncRoute` wrapper (BP-04, BP-05) unnecessary. `uuid` v9 is EOL; v11 adds time-ordered UUIDs and drops CJS shims.

**Recommendation**: Plan an Express 5 migration. It is a small-surface change for this codebase since all routes already use `async` functions.

---

### BP-12 — Severity: Low
**No `engines` Field; Jest ESM Flag Undocumented in Source**

`package.json` has no `engines` field. The `--experimental-vm-modules` flag required for `jest.unstable_mockModule` is only documented in `MEMORY.md`, not in code. New contributors running `npm test` get the flag automatically (embedded in the script), but there is no explanation of why.

**Recommendation**: Add `"engines": { "node": ">=20" }` and an inline comment in the test script.

---

### BP-13 — Severity: Low
**`express-validator` `validate()` Helper Exists but Is Inconsistently Used**

Most routes perform ad-hoc inline validation (`if (!message || typeof message !== 'string'`). Only auth routes use the `validate()` middleware consistently. This dual-pattern means `express-validator` sanitisation (`escape()`, `trim()`) is not applied uniformly.

**Recommendation**: Adopt `validate()` uniformly across all user-facing inputs, especially `chat.js`, `admin.js`, and `profile.js`.

---

## CI/CD & DevOps Findings

### OPS-01 — Severity: Critical
**No Automated Deployment — All Releases Are Manual SSH**

The CI workflow (`.github/workflows/build-node.js.yml`) builds and tests but has no CD step. Every release requires a human to SSH into the EC2 instance and manually run `git pull` + `docker compose build` + `docker compose up -d`. There is no audit trail, no rollback automation, and a failed mid-deployment build can leave the service down for several minutes.

**Recommendation**: Add a `deploy` GitHub Actions job on push to `main` using `appleboy/ssh-action`. Tag Docker images with the Git SHA and push to GHCR (free tier). Reference image tags in compose files so rollback is a tag change.

---

### OPS-02 — Severity: Critical (Carry-over SEC-02, CVSS 9.0)
**Production Runs on Plain HTTP with `COOKIE_SECURE=false`**

The deployment runbook directs operators to `compose.http.yml` exclusively. The `compose.prod.yml` with Caddy/Let's Encrypt exists but is documented as an alternative. All student credentials and session cookies traverse the network in cleartext.

**Recommendation**: Switch the primary documented deployment path to `compose.prod.yml` with Caddy automatic TLS. Cloudflare Tunnel is a zero-config alternative if a domain is unavailable.

---

### OPS-03 — Severity: High (Carry-over DOC-08)
**`compose.yml` Passes `REACT_APP_API_BASE` but Dockerfile Expects `VITE_API_BASE`**

`REACT_APP_API_BASE` is silently discarded. `VITE_API_BASE` is empty at build time. Any environment relying on `compose.yml` alone gets the wrong API base URL baked into the frontend bundle.

**Immediate fix**: Rename in `compose.yml`:
```yaml
VITE_API_BASE: "/api"
```

---

### OPS-04 — Severity: High
**Backup Cron Is Not Provisioned by IaC; No Offsite Upload; No Verification**

The backup runbook describes a manual cron job setup. There is no automation confirming the cron is running, that dumps are non-empty, or that files are uploaded off-server. An EC2 instance loss means permanent data loss.

**Recommendation**: Add `scripts/setup-host.sh` with an idempotent crontab entry + AWS CLI S3 upload step. Add a weekly health-check cron confirming the most recent dump is < 25 hours old and > 1 KB.

---

### OPS-05 — Severity: High (Carry-over PERF-03)
**DB Pool Has No Explicit Limits or Statement Timeout**

Default `max: 10` connections consumes 33% of the `max_connections=30` Postgres instance. No `statement_timeout` means a stalled PGMoE query can hold a connection indefinitely.

---

### OPS-06 — Severity: Medium
**Node 18 is EOL in CI and Dockerfiles; ESM Test Flags Incorrect in CI**

Node 18 reached end-of-life on 30 April 2025 — no more security patches. The CI backend test step invokes `npm test -- --coverage` without the required `NODE_OPTIONS='--experimental-vm-modules'` flag, potentially masking ESM-related test failures.

**Recommendation**: Upgrade to Node 20 LTS. Fix CI test step to: `NODE_OPTIONS='--experimental-vm-modules' npm test -- --coverage`.

---

### OPS-07 — Severity: Medium
**No Staging Environment; Dev/Prod Configurations Diverge Significantly**

Dev uses `SIMULATION_MODE=true`, `DEBUG_LLM=true`, exposed DB port, and a permissive session secret. Production differs on all of these. Changes are tested once in dev then deployed directly to the instance holding real student data.

**Recommendation**: Create `compose.staging.yml` mirroring production settings. Document a pre-release checklist: start staging stack → smoke test → deploy to EC2.

---

### OPS-08 — Severity: Medium
**File-Based Secrets with No Rotation Mechanism or Documentation**

All secrets are in a plaintext `.env` file on the EC2 instance. No rotation runbook exists. `.env.example` uses `PGPASSWORD=password` — a weak default that could be copy-pasted to production. `SESSION_SECRET` rotation invalidates all active sessions simultaneously with no graceful migration path.

**Recommendation**: Replace `PGPASSWORD=password` with `PGPASSWORD=CHANGE_ME_STRONG_PASSWORD`. Document a secret rotation runbook. Add `SESSION_SECRET_LEGACY` support for graceful session rotation.

---

### OPS-09 — Severity: Medium
**Health Endpoint Returns 200 Unconditionally — Reports Healthy During DB Outage**

`GET /api/health` always returns `{"status":"ok"}`. Docker's healthcheck uses this endpoint, so the container is marked `healthy` even when Postgres is unreachable.

**Recommendation**: Add a `SELECT 1` DB probe with a 2-second timeout. Return `503` with `{"status":"degraded","db":"unreachable"}` on failure. Optionally include `cron_last_run` and `uptime_seconds` fields.

---

### OPS-10 — Severity: Medium
**No Test Coverage Threshold in CI — Coverage Is Computed but Not Enforced**

The CI job produces a coverage report that is discarded. No Jest threshold is configured. New code can be merged with 0% coverage and CI stays green.

**Recommendation**: Add to `jest.config.js`:
```json
"coverageThreshold": { "global": { "lines": 60, "functions": 60 } }
```

---

### OPS-11 — Severity: Medium
**Migration Tooling Present but Not Described in Runbook; Concurrent-Start Risk**

`node-pg-migrate` is used (20 migration files) and the Dockerfile CMD runs migrations before starting the server. But the deployment runbook only mentions `CREATE TABLE IF NOT EXISTS` auto-migrations, and there is no documentation of the advisory lock that prevents concurrent migration runs.

**Recommendation**: Clarify the runbook. Consider an init-container pattern (a separate `migrate` compose service that runs and exits before the backend starts).

---

### OPS-12 — Severity: Low
**Nightly Cron Has No External Liveness Signal or Missed-Run Detection**

If the cron stops executing (event loop crash, container restart), the only way to discover it is to manually check `docker logs backend`. No alerting fires.

**Recommendation**: Send a ping to a free dead-man's-switch service (Healthchecks.io) at the end of each successful cron run, and expose last-cron-run timestamp in the health endpoint.

