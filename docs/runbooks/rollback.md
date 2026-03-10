# Rollback Runbook

Use this when a deployment causes regressions (score errors, auth failures, 500 responses).

---

## Step 1 — Identify the Last Good State

```bash
# Check currently running image tags
docker compose -f compose.yml -f compose.http.yml images

# Check git log for the last known-good commit
git log --oneline -10
```

Note the commit hash or image tag of the last good deploy.

---

## Step 2 — Code Rollback (recommended)

```bash
# On the server
cd /home/ubuntu/StudentAidApp

# Reset to last good commit (replace <HASH> with actual commit)
git fetch StudentAidApp
git checkout <HASH>

# Rebuild and restart
docker compose -f compose.yml -f compose.http.yml build
docker compose -f compose.yml -f compose.http.yml up -d
```

---

## Step 3 — Docker Image Rollback (if images are tagged)

If images are pushed to a registry with version tags:

```bash
# Edit compose.yml to pin image to last-good tag, e.g.:
#   image: studentaidapp/backend:v1.2.3

docker compose -f compose.yml -f compose.http.yml pull
docker compose -f compose.yml -f compose.http.yml up -d
```

---

## Step 4 — Verify Scoring Pipeline After Rollback

```bash
# 1. Check backend is up
curl http://localhost:80/api/health

# 2. Check recent score computation logs
docker logs backend --since 1h | grep -i "cron\|score\|error"

# 3. Manually trigger recomputation (admin session required)
# POST /api/admin/recompute-scores
```

---

## Step 5 — Database Migration Rollback

**Only needed if the bad deploy included schema changes (rare).**

1. Stop the backend:
   ```bash
   docker compose -f compose.yml -f compose.http.yml stop backend
   ```

2. Restore from a pre-migration backup (see `backup-restore.md`).

3. Restart with the rolled-back code:
   ```bash
   docker compose -f compose.yml -f compose.http.yml up -d
   ```

> **Warning:** Rolling back DB schema will lose any data written since the migration. Always back up first.

---

## Deciding Whether to Roll Back the Database

| Situation | Roll back DB? |
|-----------|--------------|
| New column added, old code ignores it | No |
| Column removed that old code relies on | Yes |
| Data-only change (seed data, config row) | No |
| Table structure fundamentally changed | Yes |
