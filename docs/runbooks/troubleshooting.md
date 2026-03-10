# Troubleshooting Runbook

## Checking Logs

```bash
# Last hour of backend logs
docker logs backend --since 1h

# Follow live
docker logs backend -f

# Filter for errors only
docker logs backend --since 1h 2>&1 | grep -i error

# PostgreSQL logs
docker logs postgres --since 1h
```

---

## Common Issues

### 1. Cold Start — Scores Not Appearing

**Symptom:** Dashboard shows "Building your profile" for all concepts.

**Cause:** PGMoE clustering requires at least 10 real users with data. Until then, the system returns `coldStart: true`.

**Check:**
```bash
# Count real users with data in the last 7 days
docker exec postgres psql -U postgres postgres -c "
SELECT 'sleep' AS concept, COUNT(DISTINCT user_id) FROM public.sleep_sessions WHERE is_simulated=false AND session_date >= CURRENT_DATE - 7
UNION ALL
SELECT 'lms', COUNT(DISTINCT user_id) FROM public.lms_sessions WHERE is_simulated=false AND session_date >= CURRENT_DATE - 7;
"
```

**Resolution:** More real students need to submit data. Cold start resolves automatically when ≥ 10 users have data.

---

### 2. Moodle Token Invalid / LMS Sync Failing

**Symptom:** LMS sync returns 502, admin panel shows "disconnected".

**Check:**
```bash
docker logs backend --since 1h | grep -i "moodle\|502\|token"
```

**Resolution:**
1. Log in to Moodle admin as admin.
2. Go to Site Administration → Server → Web services → Manage tokens.
3. Delete the old token and create a new one for the `LocalTesting` service.
4. Update `MOODLE_TOKEN` in `.env` and restart:
   ```bash
   docker compose -f compose.yml -f compose.http.yml restart backend
   ```

---

### 3. LLM / Chatbot Offline

**Symptom:** Chat returns error or times out.

**Check:**
```bash
docker logs backend --since 30m | grep -i "llm\|timeout\|502"
# Also verify the LLM service is reachable from the container
docker exec backend curl -s http://host.docker.internal:1234/health
```

**Resolution:**
- Ensure LMStudio (or whichever LLM provider) is running and listening on the configured port.
- Check `LLM_BASE_URL` and `LLM_MAIN_MODEL` in `.env`.
- Update via the Admin → LLM Config page if the model name changed.

---

### 4. Manual Score Recomputation

Use after a CSV import or data correction to immediately update scores without waiting for midnight cron:

```bash
# Requires an admin session cookie
curl -X POST http://localhost:80/api/admin/recompute-scores \
  -H "Cookie: connect.sid=<your-session-cookie>"
```

Response:
```json
{ "recomputed": 18, "errors": 0, "total": 18 }
```

---

### 5. Reset a Single User's Data

To clear all scored/clustered data for one user (keeps login credentials):

```bash
docker exec -it postgres psql -U postgres postgres
```

```sql
-- Replace '<user-id>' with the actual UUID
DELETE FROM public.concept_scores           WHERE user_id = '<user-id>';
DELETE FROM public.concept_score_history    WHERE user_id = '<user-id>';
DELETE FROM public.user_cluster_assignments WHERE user_id = '<user-id>';
DELETE FROM public.sleep_sessions           WHERE user_id = '<user-id>';
DELETE FROM public.screen_time_sessions     WHERE user_id = '<user-id>';
DELETE FROM public.lms_sessions             WHERE user_id = '<user-id>';
DELETE FROM public.srl_responses            WHERE user_id = '<user-id>';
DELETE FROM public.srl_annotations          WHERE user_id = '<user-id>';
```

Then trigger recomputation (step 4 above).

---

### 6. PostgreSQL Connection Errors

**Symptom:** Backend logs show `ECONNREFUSED` or `connection to server failed`.

**Common causes:**

| Error | Fix |
|-------|-----|
| `ECONNREFUSED 127.0.0.1:5432` | Backend is pointing to localhost instead of the `postgres` container. Check `PGHOST=postgres` in `.env` |
| `password authentication failed` | Wrong `PGPASSWORD` in `.env` |
| `database "postgres" does not exist` | DB not initialised; run restore from backup or restart postgres container |
| `too many connections` | Connection pool exhausted; check for hung backend processes and restart |

```bash
# Check postgres is accepting connections
docker exec postgres pg_isready -U postgres

# Check active connections
docker exec postgres psql -U postgres postgres -c "SELECT count(*) FROM pg_stat_activity;"
```

---

### 7. Session / Cookie Issues

**Symptom:** Users get logged out unexpectedly, or login always returns 401.

**Check:**
- `SESSION_SECRET` in `.env` is consistent across restarts (never randomly regenerated).
- `COOKIE_SECURE=false` is set when running on plain HTTP (no HTTPS).
- `CORS_ORIGINS` matches the exact frontend URL (no trailing slash).

```bash
docker logs backend --since 30m | grep -i "session\|cookie\|401"
```
