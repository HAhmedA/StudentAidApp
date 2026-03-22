# CLAUDE.md

## Project Overview

Student Wellbeing Dashboard -- a React + Express + PostgreSQL web app that tracks sleep, screen time, LMS activity, and self-regulated learning (SRL) across four concepts. Scoring uses PGMoE (Parsimonious Gaussian Mixture of Experts) clustering to position each student relative to peers. Includes an LLM-powered chatbot for contextual wellbeing advice. Deployed to ~100 users via Docker on AWS EC2 and a separate ESM production server.

## Quick Commands

- Dev server: `npm start` (Vite, port 3000)
- Backend: `cd backend && node server.js`
- Tests: `cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage`
- Build: `npm run build` (Vite -> build/)
- Docker: `docker compose up -d --build`
- Migrations: `cd backend && npm run migrate`

## Architecture

- **Backend**: ESM Node.js (`import`/`export`, `.js` files), Express, PostgreSQL (`pg` pool -- no ORM)
- **Frontend**: React 18 + TypeScript, Redux Toolkit, Vite (migrated from CRA)
- **Data flow**: User input -> Simulators/Moodle -> Daily tables -> Annotators -> Scoring (PGMoE) -> Dashboard + Chatbot

## Key Conventions

- Backend service files: `*Service.js` pattern in `backend/services/`
- Frontend API: Use `src/api/client.ts` (`api.get`/`post`/`put`/`delete`) -- NOT axios directly
- Error handling: `AppError` + `Errors.*` factory from `backend/utils/errors.js`; wrap route handlers with `asyncRoute()`
- Tests: Jest with ESM -- use `jest.unstable_mockModule` + dynamic `await import()`, NOT `jest.mock()`
- Config: Canonical concept metadata in `backend/config/concepts.js` (SINGLE SOURCE OF TRUTH for concept definitions)
- Env vars: Frontend uses `VITE_*` prefix (build-time); backend reads from `process.env`
- Database: Always use the singleton pool from `backend/config/database.js` -- never create a new `pg.Pool`
- SQL: Always parameterize queries (`$1`, `$2`) -- never interpolate user input into SQL strings
- Transactions: Use `withTransaction()` from `backend/utils/withTransaction.js` for multi-step writes

## Critical Gotchas

These are the hard-won lessons -- read these carefully.

- `npm ci --legacy-peer-deps` required (lockfile was generated with this flag)
- `compose.esm.yml` is STANDALONE (not layered on `compose.yml`) -- env vars must be duplicated in its own environment block
- `lmsDataSimulator.js` was removed (dead code -- replaced by `moodleEventSimulator.js`)
- `last_sync` display uses `MAX(lms_sessions.created_at)` which does NOT update on upsert conflict -- repeated syncs do not refresh the displayed timestamp
- Moodle: `mod_assign_save_submission` creates a DRAFT -- must also call `mod_assign_submit_for_grading` to transition to submitted status
- PGMoE requires minimum 10 real users with data to produce scores (`coldStart: true` until then)
- `reading_minutes` and `watching_minutes` are always 0 with Moodle module REST APIs (by design -- event log not accessible to external tokens)
- Rate limit store is in-memory -- resets on container restart
- `pool.on('error')` and SIGTERM handler were added (Mar 2026) -- previously missing and caused crashes

## Environment Variables

### Required in Production

- `SESSION_SECRET` -- Must NOT be `dev-secret`
- `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` -- PostgreSQL connection
- `PGPASSWORD` -- Must NOT be `password`

### Recommended

- `CORS_ORIGINS` -- Comma-separated allowed origins (no wildcard in prod)
- `LLM_BASE_URL`, `LLM_MAIN_MODEL`, `LLM_JUDGE_MODEL` -- LLM configuration
- `MOODLE_BASE_URL`, `MOODLE_TOKEN` -- Moodle REST API connection
- `MOODLE_AUTO_LOGIN_KEY` -- Enables zero-friction auto-login from Moodle
- `SIMULATION_MODE` -- Set `false` in production (prevents test data seeding)
- `APP_BASE_PATH` -- Post-login redirect path (default `/`, ESM uses `/esm/`)
- `VITE_API_BASE` -- Frontend API base URL (default `/api`)
- `COOKIE_SECURE` -- Set `false` for plain HTTP deployments

## Key File Map

### Backend

- `backend/server.js` -- Express app entry point, middleware chain
- `backend/config/concepts.js` -- Canonical concept definitions (sleep, srl, lms, screen_time)
- `backend/config/database.js` -- PostgreSQL connection pool (singleton)
- `backend/config/envValidation.js` -- Env var validation (required vs recommended)
- `backend/controllers/authController.js` -- Login, register, Moodle auto-login
- `backend/middleware/rateLimit.js` -- API rate limiting (500/15min general, 50/15min auth, 10/min chat)
- `backend/utils/errors.js` -- AppError class + Errors.* factory + asyncRoute wrapper
- `backend/services/scoring/clusterPeerService.js` -- DIMENSION_DEFS + PGMoE clustering
- `backend/services/scoring/scoreQueryService.js` -- Raw SQL for clustering metrics
- `backend/services/scoring/scoreComputationService.js` -- Scoring pipeline orchestrator
- `backend/services/scoring/conceptScoreService.js` -- Percentile within cluster -> 0-100 score + trend
- `backend/services/scoring/peerStatsService.js` -- Z-score peer comparison (fallback to PGMoE)
- `backend/services/moodleService.js` -- Moodle REST API integration
- `backend/services/moodleEventSimulator.js` -- Mock LMS data for test accounts
- `backend/services/simulationOrchestratorService.js` -- Coordinates all simulators on registration
- `backend/services/cronService.js` -- Nightly cron for score recomputation
- `backend/services/contextManagerService.js` -- Chatbot context assembly
- `backend/services/promptAssemblerService.js` -- LLM prompt construction with token budgeting
- `backend/services/alignmentService.js` -- LLM-as-Judge response validation
- `backend/services/inputGuardService.js` -- Input sanitization + safety checks

### Frontend

- `src/api/client.ts` -- Shared fetch-based API client (api.get/post/put/delete)
- `src/components/Chatbot.tsx` -- AI chatbot widget with feedback
- `src/components/DailyWizard.tsx` -- Multi-step onboarding (consent -> sleep -> screen time -> SRL)
- `src/components/ScoreBoard.tsx` -- Dashboard score display
- `src/components/ScoreGauge.tsx` -- Individual concept gauge
- `src/pages/Home.tsx` -- Main dashboard (students) / admin panel (admins)
- `src/redux/auth.ts` -- Authentication state
- `src/constants/concepts.ts` -- Concept display names, tips, descriptions

## Scoring Pipeline

```
User data (sleep/screentime/LMS/SRL tables)
  -> scoreQueryService.js (SQL -> raw metrics per user)
  -> clusterPeerService.js (PGMoE clustering: K=2..4, EM convergence)
  -> conceptScoreService.js (percentile within cluster -> 0-100 score + trend)
  -> concept_scores table (dashboard reads from here)
```

## Deployment

- **Local**: `docker compose up -d --build`
- **EC2 t2.micro** (plain HTTP): `docker compose -f compose.yml -f compose.http.yml up -d --build`
  - 1GB RAM + 2GB swap; postgres tuned (64MB shared_buffers, 30 max_connections)
- **ESM** (ueflearninganalytics.site/esm/): `docker compose -f compose.esm.yml up -d --build`
  - STANDALONE compose file, own postgres volume (`pgdata_esm`), own `.env`
- **Production HTTPS**: `docker compose -f compose.yml -f compose.prod.yml up -d --build`
  - Caddy auto-provisions Let's Encrypt cert; requires `DOMAIN` env var

## Git Remotes

- **Always push to `StudentAidApp`** -- deployment remote (github.com/HAhmedA/StudentAidApp)
- `origin` points to TestAPP -- NEVER push here
- `UbuntuTest` -- previous deployment remote, no longer used
- `ABC` -- do not push unless explicitly asked
