# Review Scope

## Target

Full backend review of the Node.js/Express student wellbeing dashboard API.
Covers the current `main` branch following two significant commits:
- `04eaee5` — P1 code quality, security, and operational improvements (10 findings addressed)
- `d524dc2` — chatbot UI, score gauges, profile/run/sleep page improvements

## Files

### Core
- `backend/server.js`
- `backend/config/envValidation.js`
- `backend/config/database.js`
- `backend/config/swagger.js`
- `backend/constants.js`

### Routes (14 files)
- `backend/routes/index.js`
- `backend/routes/admin.js`
- `backend/routes/auth.js`
- `backend/routes/annotations.js`
- `backend/routes/chat.js`
- `backend/routes/lms.js`
- `backend/routes/scores.js`
- `backend/routes/screen-time.js`
- `backend/routes/sleep.js`
- `backend/routes/surveys.js`
- `backend/routes/profile.js`
- `backend/routes/results.js`
- `backend/routes/mood.js`
- `backend/routes/csvLog.js`

### Middleware
- `backend/middleware/auth.js`
- `backend/middleware/rateLimit.js`
- `backend/middleware/validation.js`

### Controllers
- `backend/controllers/authController.js`

### Services — Scoring Pipeline
- `backend/services/scoring/scoreQueryService.js`
- `backend/services/scoring/clusterPeerService.js`
- `backend/services/scoring/clusterStorageService.js`
- `backend/services/scoring/conceptScoreService.js`
- `backend/services/scoring/scoreComputationService.js`
- `backend/services/scoring/pgmoeAlgorithm.js`
- `backend/services/scoring/scoringStrategies.js`
- `backend/services/scoring/peerStatsService.js`
- `backend/services/scoring/index.js`

### Services — Annotators
- `backend/services/annotators/lmsAnnotationService.js`
- `backend/services/annotators/sleepAnnotationService.js`
- `backend/services/annotators/screenTimeAnnotationService.js`
- `backend/services/annotators/srlAnnotationService.js`

### Services — LMS / Simulation
- `backend/services/moodleService.js`
- `backend/services/moodleEventSimulator.js`
- `backend/services/simulationOrchestratorService.js`
- `backend/services/simulators/sleepDataSimulator.js`
- `backend/services/simulators/screenTimeDataSimulator.js`
- `backend/services/simulators/srlDataSimulator.js`
- `backend/services/simulators/lmsDataSimulator.js`

### Services — Other
- `backend/services/cronService.js`
- `backend/services/contextManagerService.js`
- `backend/services/apiConnectorService.js`
- `backend/services/promptAssemblerService.js`
- `backend/services/alignmentService.js`
- `backend/services/llmConfigService.js`
- `backend/services/seedDataService.js`
- `backend/services/summarizationService.js`
- `backend/services/chatbotPreferencesService.js`
- `backend/services/csvLogService.js`

### Utilities
- `backend/utils/logger.js`
- `backend/utils/errors.js`
- `backend/utils/withTransaction.js`
- `backend/utils/stats.js`

### Tests (28 files)
- `backend/tests/**/*.test.js`

### Infrastructure
- `compose.yml`, `compose.http.yml`, `compose.prod.yml`
- `Dockerfile`
- `.env.example`

### Docs
- `docs/runbooks/deployment.md`
- `docs/runbooks/rollback.md`
- `docs/runbooks/backup-restore.md`
- `docs/runbooks/troubleshooting.md`

## Flags

- Security Focus: no
- Performance Critical: no
- Strict Mode: no
- Framework: React + Node.js/Express + PostgreSQL (ESM, Vite frontend)

## Tech Stack Notes

- **Backend**: Node.js ESM, Express, PostgreSQL (pg pool), express-session + connect-pg-simple
- **Scoring**: PGMoE (Parsimonious Gaussian Mixture of Experts) clustering — custom implementation
- **LMS**: Moodle 5.x REST API integration
- **AI/Chatbot**: configurable LLM provider via REST (LMStudio, OpenAI, etc.)
- **Test runner**: Jest with `--experimental-vm-modules` (ESM support)
- **Deployment**: Docker Compose on EC2 t2.micro, plain HTTP on port 80

## Review Phases

1. Code Quality & Architecture
2. Security & Performance
3. Testing & Documentation
4. Best Practices & Standards
5. Consolidated Report
