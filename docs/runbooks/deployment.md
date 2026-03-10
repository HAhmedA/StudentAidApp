# Deployment Runbook

## Prerequisites

### Server
- EC2 t2.micro (1 GB RAM) with Ubuntu or Amazon Linux 2
- Docker Engine + Docker Compose plugin installed
- 2 GB swap enabled (essential on 1 GB RAM host — see below)
- Inbound ports: 80 (HTTP), 22 (SSH)

### Enable 2 GB Swap (first-time setup)
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Required environment variables
Copy `.env.example` to `.env` and fill in every non-optional value:

| Variable | Required | Notes |
|---|---|---|
| `PGHOST` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` | Yes | PostgreSQL credentials |
| `SESSION_SECRET` | Yes | At least 32 random chars in production |
| `NODE_ENV` | Yes | Set to `production` |
| `CORS_ORIGINS` | Yes | Frontend URL(s), comma-separated |
| `MOODLE_BASE_URL` + `MOODLE_TOKEN` | Optional | Required for LMS sync |
| `LLM_BASE_URL` + `LLM_MAIN_MODEL` | Optional | Required for chatbot |
| `SENTRY_DSN` | Optional | Set to enable error tracking |
| `LOG_TO_FILE` | Optional | Set `true` only for local dev |

---

## Deploy / Update

```bash
# 1. Pull latest code
cd /home/ubuntu/StudentAidApp
git pull StudentAidApp main

# 2. Ensure .env is present and correct
cp .env.example .env   # first deploy only — then edit
nano .env              # fill in values

# 3. Pull new images (if using pre-built images) or build in-place
docker compose -f compose.yml -f compose.http.yml build

# 4. Start (or restart updated) services
docker compose -f compose.yml -f compose.http.yml up -d

# 5. Verify all 4 services are running
docker compose -f compose.yml -f compose.http.yml ps
```

Expected output from step 5 — all 4 should be `Up`:
```
NAME        SERVICE    STATUS
postgres    postgres   Up
backend     backend    Up
frontend    frontend   Up (or nginx)
```

---

## First-Deploy Database Initialisation

The backend auto-creates tables on startup via `CREATE TABLE IF NOT EXISTS` migrations. No manual SQL is needed. Verify by checking the health endpoint after startup:

```bash
curl http://localhost:80/api/health
# Expected: {"status":"ok"}
```

If tables are missing, check backend logs:
```bash
docker logs backend --since 5m
```

---

## Health Check

```bash
curl http://<server-ip>/api/health
# Expected: {"status":"ok"}
```

A 200 response confirms: Express is running, session middleware is loaded, and the database connection pool is active.

---

## Verify All Services

```bash
# All containers running
docker compose -f compose.yml -f compose.http.yml ps

# Backend logs (last 50 lines)
docker logs backend --tail 50

# PostgreSQL accepting connections
docker exec postgres pg_isready -U postgres

# Frontend served
curl -I http://localhost:80/
# Expected: HTTP/1.1 200 OK
```
