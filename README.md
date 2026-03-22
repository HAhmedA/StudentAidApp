# SRL Learning Analytics Platform

A full-stack learning analytics platform that helps students improve their **self-regulated learning (SRL)** by tracking sleep, screen time, LMS engagement, and SRL questionnaire responses. It uses **AI-powered peer comparison**, **LLM-based chatbot coaching**, and **interactive dashboards** to provide personalized feedback.

---

## 🚀 Key Features

### 📊 Performance Dashboard
- **Gauge Visualizations** — SVG gauges showing per-concept scores (Sleep, Screen Time, LMS, SRL) with Today vs Yesterday needles
- **Peer Comparison** — Scores are computed via **Parsimonious Gaussian Mixture of Experts (PGMoE)** clustering, so students are compared against peers with similar behavioral patterns
- **Detailed Breakdowns** — Click any gauge to see domain-level scores, peer-group labels, and improving/declining/stable badges
- **Admin View** — Administrators can select any student and view their full dashboard

### 🤖 AI Chatbot
- **LLM-Powered Coaching** — Context-aware chatbot (Gemini / LMStudio) that references the student's actual data (scores, judgments, questionnaire trends)
- **Contextual Prompts** — Screen-specific prompt suggestions based on the page the student is viewing
- **Alignment Validation** — Every response passes through an LLM-as-Judge alignment check before being shown
- **Session Management** — Persistent chat sessions with 10-day rolling summarization
- **Customizable Prompts** — Admin-editable system and alignment prompts stored in the database
- **Chat Feedback** — Students can like/dislike chatbot messages and flag problematic responses for admin review

### 📈 Data Collection & Analysis
- **SRL Questionnaires** — 14-concept Likert-scale self-assessment (efficiency, motivation, anxiety, etc.) with trend analysis
- **Sleep Tracking** — Manual input via interactive slider component tracking bedtime, wake time, sleep quality, and awakenings
- **Screen Time Self-Report** — Daily questionnaire for total screen hours, longest session, and pre-sleep screen use (with validation)
- **LMS Activity** — Real Moodle LMS data synced via REST API (quizzes, assignments, forum posts), or simulated data for test accounts. Metrics: active minutes, session quality, participation variety
- **CSV Upload** — Admin can upload LMS activity via CSV (by email or Moodle ID)

### 🎲 Simulation Engine
- **Realistic Test Data** — Simulation orchestrator generates 7 days of correlated data across all domains for test accounts
- **Profile-Based** — Three achievement profiles (high achiever, average, low achiever) with anomaly days, weekend effects, carry-over, and daily variance
- **Automatic Scoring** — After simulation, PGMoE clustering + percentile scoring runs automatically with historical score seeding

### 🔐 Authentication & Roles
- **Session Auth** — Express sessions backed by PostgreSQL
- **Student / Admin Roles** — Students see their own dashboard + chatbot; admins can view any student's data and edit prompts
- **Moodle Auto-Login** — `GET /api/auth/moodle?USERID={moodle_id}&key={key}` provides zero-friction login from Moodle. Auto-provisions users on first visit with a 45-day session cookie
- **Support Requests** — Students can contact admin from their profile page

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React 18 + TypeScript, Vite)                  │
│  ├── Dashboard (ScoreGauge, Home, MoodHistory)           │
│  ├── Chatbot (Chatbot.tsx, feedback, contextual prompts) │
│  ├── Data Input (SleepSlider, ScreenTimeForm, Surveys)   │
│  └── Auth (Login, Register, Profile, Support)            │
└──────────────────────────┬───────────────────────────────┘
                           │ HTTP (/api)
┌──────────────────────────▼───────────────────────────────┐
│  Backend (Node.js + Express, ESM)                        │
│  ├── Routes: auth, chat, scores, mood, surveys, admin    │
│  ├── Controllers: authController (Moodle auto-login)     │
│  ├── Services:                                           │
│  │   ├── Simulators (sleep, screenTime, lms, srl)        │
│  │   ├── Annotators (rule-based judgments per domain)     │
│  │   ├── Scoring (PGMoE clustering, percentile scores)   │
│  │   ├── Chatbot (context, prompts, alignment, summary)  │
│  │   ├── Chat Feedback (like/dislike/flag)                │
│  │   ├── Support Requests (student → admin)               │
│  │   ├── Cron (nightly score recomputation)               │
│  │   └── Orchestrator (coordinates sim + scoring)        │
│  └── LLM Connector (Gemini / LMStudio / OpenAI)         │
└──────────────────────────┬───────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────┐
│  PostgreSQL 18                                           │
│  ├── Users, sessions, profiles                           │
│  ├── Data tables (sleep, screen_time, lms, srl)          │
│  ├── Judgments & annotations                             │
│  ├── Concept scores & score history                      │
│  ├── Peer clusters & user assignments                    │
│  ├── Chat sessions, messages, summaries, feedback        │
│  └── Support requests                                    │
└──────────────────────────────────────────────────────────┘
```

---

## 🛠️ Technology Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 18, TypeScript, Redux Toolkit, React Router v6, Recharts, **Vite** |
| **Surveys** | SurveyJS (Form Library, Creator, Analytics) |
| **Backend** | Node.js (ESM), Express, express-session, Helmet, Winston |
| **Database** | PostgreSQL 18, connect-pg-simple |
| **AI/LLM** | Gemini API, LMStudio, configurable via environment |
| **Containerization** | Docker, Docker Compose, Nginx |

---

## 🐳 Quick Start (Docker)

### Prerequisites
- Docker Desktop 4.30+
- (Optional) LMStudio running locally for chatbot features

### Setup

```bash
# Clone and start all services
docker compose up --build -d
```

### Access Points
| Service | URL |
|---------|-----|
| Web App | http://localhost:3000 |
| API | http://localhost:8080/api |
| PostgreSQL | localhost:5433 |

### Useful Commands
```bash
# View logs
docker compose logs -f web       # Frontend
docker compose logs -f backend   # Backend API

# Stop (preserves data)
docker compose down

# Stop and reset database (DELETES ALL DATA)
docker compose down -v
```

---

## 🚢 Deployment Targets

| Target | Command | Notes |
|--------|---------|-------|
| **Local development** | `docker compose up -d --build` | Default `compose.yml` |
| **AWS EC2 (plain HTTP)** | `docker compose -f compose.yml -f compose.http.yml up -d --build` | Port 80, RAM-tuned postgres, 2 GB swap recommended on t2.micro |
| **ESM subpath** | `docker compose -f compose.esm.yml up -d --build` | Standalone (NOT layered on `compose.yml`), runs at `/esm/` on port 3007, own postgres volume |
| **Production HTTPS** | `docker compose -f compose.yml -f compose.prod.yml up -d --build` | TLS termination |

> **Git remotes:** Push to `StudentAidApp` remote (the deployment remote). Do NOT push to `origin` (TestAPP) or `ABC`.

---

## ⚙️ Environment Configuration

Copy `.env.example` to `.env` in the backend directory. Key settings:

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_PROVIDER` | LLM provider (`lmstudio`, `gemini`, `openai`) | `lmstudio` |
| `LLM_BASE_URL` | LLM API endpoint | `http://host.docker.internal:1234` |
| `LLM_MAIN_MODEL` | Model for chat responses | `hermes-3-llama-3.2-3b` |
| `LLM_JUDGE_MODEL` | Model for alignment validation | `qwen2.5-3b-instruct` |
| `LLM_CONTEXT_LIMIT` | Max context window tokens | `32768` |
| `SESSION_SECRET` | Express session secret | (must be set) |
| `MOODLE_BASE_URL` | Base URL of your Moodle instance (e.g. `http://localhost:8888/moodle501`) | (optional) |
| `MOODLE_TOKEN` | Moodle web service token for REST API access | (optional) |
| `MOODLE_AUTO_LOGIN_KEY` | Shared key for Moodle auto-login endpoint validation | (optional) |
| `APP_BASE_PATH` | Post-login redirect path for auto-login | `/` (ESM uses `/esm/`) |
| `VITE_API_BASE` | Frontend API base URL (build-time arg) | `/api` |
| `COOKIE_SECURE` | Set to `false` for plain HTTP deployments | `true` |
| `SIMULATION_MODE` | Set to `"false"` to exclude test accounts from scoring | `"true"` |

---

## 🎓 Moodle LMS Integration

The platform can sync real LMS engagement data from a Moodle instance via its REST API.

### Setup

1. **Enable Moodle web services** — in Moodle admin: *Site Administration → Advanced Features → Enable web services*
2. **Create a web service token** — under *Site Administration → Plugins → Web services → Manage tokens*. The token needs the following functions:
   - `core_user_get_users_by_field`, `core_enrol_get_users_courses`
   - `mod_quiz_get_user_attempts`, `mod_assign_get_submissions`
   - `mod_forum_get_forum_discussions`, `mod_forum_get_discussion_posts`
3. **Set environment variables** in your `.env` (or Docker secret):
   ```bash
   MOODLE_BASE_URL=http://your-moodle-host/moodle
   MOODLE_TOKEN=your-webservice-token
   ```
4. **Associate users** — each platform user must have a matching Moodle account (same email). Use the Admin panel's *LMS Sync* tab to trigger per-student or bulk sync.

### Moodle Auto-Login

For zero-friction access from within Moodle, configure a URL resource pointing to:
```
GET /api/auth/moodle?USERID={moodle_id}&key={MOODLE_AUTO_LOGIN_KEY}
```
- Auto-provisions a user on first visit (name "Student {id}", email `moodle_{id}@auto.local`)
- Issues a 45-day session cookie
- Redirects to `APP_BASE_PATH` after login
- In Moodle, use a URL resource with the URL variable `USERID` mapped to `id`

### What Gets Synced

| Moodle Activity | DB Column | LMS Dimension |
|---|---|---|
| Quiz attempts | `exercise_practice_events` | participation_variety |
| Assignment submissions | `assignment_work_events` | participation_variety |
| Forum posts | `forum_posts` | participation_variety |
| Active session minutes | `total_active_minutes` | volume |
| Session count | `number_of_sessions` | session_quality |

### Cold Start

PGMoE requires a minimum of **10 real users with LMS data** before it can fit a meaningful cluster model. Until that threshold is reached, the scoring service returns a `coldStart: true` flag and the dashboard displays a "not enough data yet" state.

### Limitations

- `reading_minutes` and `watching_minutes` are always 0 when using Moodle module-level REST APIs (the event log is not accessible via external tokens).
- Moodle forum posts fetched via `mod_forum_get_discussion_posts` require iterating one thread per request; bulk syncing many students is intentionally slow.

---

## 💻 Local Development (Frontend Only)

```bash
npm install
npm start          # runs Vite dev server
```

> **Note:** The project uses **Vite** (migrated from Create React App). Environment variables use the `VITE_*` prefix (e.g. `VITE_API_BASE`), not `REACT_APP_*`.

> Features requiring API authentication, database, or LLM will not work without the backend services.

---

## 🧪 Testing

```bash
# Backend tests (ESM — requires --experimental-vm-modules)
cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage

# Frontend type check
npx tsc --noEmit

# Production build
npm run build
```

- **142+ tests** across **19 suites** (30 test files in `backend/tests/`)
- Test directories: `backend/tests/`, `backend/tests/scoring/`, `backend/tests/annotators/`, `backend/tests/integration/`, `backend/tests/unit/`, `backend/tests/services/`
- ESM mock pattern: `jest.unstable_mockModule` + dynamic `await import(...)`

---

## 📁 Project Structure

```
├── src/                        # React frontend (Vite + TypeScript)
│   ├── components/             # ScoreGauge, Chatbot, SleepSlider, etc.
│   ├── pages/                  # Home, Login, Register, MoodHistory, Profile, ScreenTimeForm
│   ├── api/                    # Base API client (client.ts)
│   ├── redux/                  # Redux Toolkit slices (auth, surveys, etc.)
│   └── routes/                 # React Router configuration
├── backend/                    # Express API server (Node.js ESM)
│   ├── routes/                 # API routes (auth, chat, scores, admin, mood, etc.)
│   ├── controllers/            # Request handlers (authController.js)
│   ├── services/
│   │   ├── simulators/         # Data generators (sleep, screenTime, lms, srl)
│   │   ├── annotators/         # Rule-based judgment engines
│   │   └── scoring/            # PGMoE clustering, score computation, peer stats
│   ├── scripts/                # 13 utility/setup scripts (moodleSetup, recompute, etc.)
│   ├── tests/                  # 30 test files across 6 directories
│   ├── prompts/                # System & alignment prompt files
│   └── config/                 # Database, logging configuration
├── postgres/initdb/            # SQL schema initialization scripts
├── docs/                       # Detailed documentation
│   ├── runbooks/               # Deployment, backup, rollback, troubleshooting
│   ├── annotation_pipeline.md
│   ├── peer_comparison_scoring_system.md
│   ├── simulated_data_documentation.md
│   └── chatbot-flows.md
├── compose.yml                 # Docker Compose — default (local dev)
├── compose.http.yml            # Override — plain HTTP (AWS EC2)
├── compose.esm.yml             # Standalone — ESM subpath deployment
├── compose.prod.yml            # Override — production HTTPS
└── Dockerfile                  # Frontend build + Nginx
```

---

## 📖 Documentation

Detailed documentation is available in the `docs/` directory:

- **[Annotation Pipeline](docs/annotation_pipeline.md)** — Full data flow from simulators → judgments → scores → frontend
- **[Peer Comparison & Scoring](docs/peer_comparison_scoring_system.md)** — PGMoE clustering, percentile scoring, gauge visualization
- **[Simulated Data](docs/simulated_data_documentation.md)** — All simulator attributes, thresholds, and annotation rules
- **[Chatbot Flows](docs/chatbot-flows.md)** — Greeting, messaging, alignment, and reset interaction flows
- **[Developer Guide](docs/DEVELOPER_GUIDE.md)** — Architecture, design patterns, naming conventions, and extension guide
- **[Runbooks](docs/runbooks/)** — Deployment, backup/restore, rollback, and troubleshooting guides
