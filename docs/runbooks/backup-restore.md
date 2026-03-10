# Backup & Restore Runbook

## Manual PostgreSQL Backup

```bash
# Dump the entire database to a SQL file
docker exec postgres pg_dump -U postgres postgres > backup_$(date +%Y%m%d_%H%M%S).sql

# Verify the backup is non-empty
wc -l backup_*.sql
```

Store the `.sql` file off-server (S3, local machine, etc.).

---

## Scheduled Backup (Recommended for Production)

Add a cron job on the EC2 host (not inside Docker) to back up nightly:

```bash
crontab -e
# Add:
0 2 * * * docker exec postgres pg_dump -U postgres postgres > /home/ubuntu/backups/db_$(date +\%Y\%m\%d).sql 2>&1
```

Keep at least 7 days of backups. To auto-prune old backups:

```bash
# Also add to crontab (keep 7 days):
0 3 * * * find /home/ubuntu/backups/ -name "db_*.sql" -mtime +7 -delete
```

---

## Restore Procedure

> **Stop the backend first** to prevent writes during restore.

```bash
# 1. Stop backend (keep postgres running)
docker compose -f compose.yml -f compose.http.yml stop backend

# 2. Drop and recreate the database
docker exec -it postgres psql -U postgres -c "DROP DATABASE IF EXISTS postgres;"
docker exec -it postgres psql -U postgres -c "CREATE DATABASE postgres;"

# 3. Restore from backup file
docker exec -i postgres psql -U postgres postgres < backup_20260310_020000.sql

# 4. Restart backend
docker compose -f compose.yml -f compose.http.yml start backend

# 5. Verify
curl http://localhost:80/api/health
```

---

## Testing Restore on Staging

Before relying on a backup in a real incident, validate it:

1. Spin up a temporary Postgres container:
   ```bash
   docker run --name pg-test -e POSTGRES_PASSWORD=test -d postgres:15
   ```

2. Restore the backup into it:
   ```bash
   docker exec -i pg-test psql -U postgres postgres < backup.sql
   ```

3. Spot-check key tables:
   ```bash
   docker exec pg-test psql -U postgres postgres -c "SELECT COUNT(*) FROM public.users;"
   docker exec pg-test psql -U postgres postgres -c "SELECT COUNT(*) FROM public.concept_scores;"
   ```

4. Clean up:
   ```bash
   docker rm -f pg-test
   ```

---

## What Is Backed Up

The `pg_dump` captures the entire `postgres` database, including:

- `users`, `student_profiles`
- `sleep_sessions`, `screen_time_sessions`, `lms_sessions`
- `concept_scores`, `concept_score_history`, `user_cluster_assignments`, `peer_clusters`
- `srl_annotations`, `srl_responses`
- `system_prompts`, `llm_config`
- `chat_sessions`, `chat_messages`
- `session` (express-session store)

**Not captured:** Docker image layers, uploaded CSV files (if stored on disk outside Postgres).
