# Moodle CSV Activity Log Upload — Design Document

**Date:** 2026-03-02
**Status:** Approved

---

## Problem

The app is not yet authorized to connect directly to the university's Moodle instance.
The interim solution: the admin manually exports the Moodle course activity log as a CSV
each week and uploads it through the admin panel. The feature must parse that file,
map participants to app accounts, and update each student's LMS session data identically
to the existing Moodle sync pipeline.

Students register with aliases (not real names) for privacy. The admin knows the
real-name → alias → email mapping and performs it manually through a pairing UI.

---

## Approach: Two-Step Upload + Persistent Mapping

### Phase 1 — Upload
Admin uploads the Moodle CSV export. Backend parses it, extracts all unique participant
names, stores the raw CSV + metadata in the DB, and returns names to the frontend.

### Phase 2 — Mapping (persists across uploads)
Admin uses a dual-list UI to pair CSV names (real names from Moodle) with app student
emails. Pairs are saved immediately to a `csv_participant_aliases` table. On future
uploads, already-paired names appear pre-filled; only new/late-registering students
appear unmatched and need attention.

### Phase 3 — Import
Admin clicks "Import". Backend reads the stored CSV, filters rows to paired names only,
runs the EALT session algorithm, classifies events by type, and upserts into the existing
`lms_sessions` table. Triggers score recomputation for all affected students.

---

## Data Model

### `csv_log_uploads`
```sql
id              uuid PRIMARY KEY DEFAULT uuid_generate_v4()
uploaded_by     uuid REFERENCES public.users(id)
filename        text NOT NULL
csv_content     text NOT NULL        -- raw CSV stored in DB
row_count       int NOT NULL
date_range_start date NOT NULL       -- earliest event date in file
date_range_end   date NOT NULL       -- latest event date in file
status          text NOT NULL DEFAULT 'pending'  -- 'pending' | 'imported' | 'failed'
uploaded_at     timestamptz NOT NULL DEFAULT now()
imported_at     timestamptz NULL
```

### `csv_participant_aliases`
```sql
id          uuid PRIMARY KEY DEFAULT uuid_generate_v4()
csv_name    text NOT NULL UNIQUE     -- exactly as it appears in "User full name" column
user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE
created_at  timestamptz NOT NULL DEFAULT now()
```

The UNIQUE constraint on `csv_name` ensures one-to-one mapping. No changes to
`lms_sessions` — CSV import writes to it identically to Moodle sync,
with `is_simulated = false`.

---

## API Endpoints

All routes are admin-only (`requireAdmin` middleware), mounted under `/api/lms/admin/csv/`.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/upload` | Accept CSV (multipart), parse, store, return unique names + existing mappings |
| `GET` | `/participants` | Return all `csv_participant_aliases` (restore mapping UI on reload) |
| `POST` | `/mapping` | Upsert a `csv_name → user_id` pair |
| `DELETE` | `/mapping/:csvName` | Remove a pair |
| `POST` | `/import/:uploadId` | Process stored CSV using current mappings → upsert `lms_sessions` |

### Upload response
```json
{
  "uploadId": "uuid",
  "rowCount": 1842,
  "dateRange": { "start": "2026-02-24", "end": "2026-03-02" },
  "csvNames": ["Ahmed Al-Rashid", "Sara Malik", "..."],
  "existingMappings": {
    "Ahmed Al-Rashid": { "userId": "...", "email": "ahmed@uni.edu" }
  }
}
```

### Import response
```json
{
  "imported": 14,
  "skipped": 3,
  "details": [
    { "csvName": "Ahmed Al-Rashid", "email": "ahmed@uni.edu", "daysUpdated": 5, "totalEvents": 47 },
    { "csvName": "Sara Malik", "email": "sara@uni.edu", "daysUpdated": 7, "totalEvents": 83 }
  ]
}
```

Import runs synchronously (not a background job) — processing 20–30 students
from a weekly CSV takes only seconds.

---

## Frontend Component: `AdminCsvLogPanel.tsx`

New collapsible panel in the admin page, styled consistently with the existing
Moodle sync panel in `AdminStudentViewer.tsx`. Three visual states:

### State 1 — Upload
File drop zone / picker with instructions. Accepts `.csv` files only.

### State 2 — Mapping UI
```
┌─ List A (Student Emails) ───┐  ┌─ List B (CSV Names) ─────────┐
│ 🔍 Search...                │  │ 🔍 Search...                  │
│ ○ ahmed@uni.edu             │  │ ○ Sara Malik Al-Hamad         │
│ ● sara@uni.edu   ← selected │  │ ● Ahmed Al-Rashid  ← selected │
│ ○ john@uni.edu              │  │ ○ John Smith                  │
└─────────────────────────────┘  └──────────────────────────────┘
              [ Make Pair ]

Pairs
──────────────────────────────────────────────────────
ahmed@uni.edu        →   Ahmed Al-Rashid          ✕
sara@uni.edu         →   Sara Malik Al-Hamad       ✕
──────────────────────────────────────────────────────

[ Import CSV (14 paired students) ]
```

- Already-paired names are greyed out in both lists (cannot double-pair)
- Pairs save to DB immediately on "Make Pair" — no separate Save button
- Delete (✕) removes the pair from DB immediately
- Mappings persist across uploads; returning admin sees pre-filled pairs

### State 3 — Import Result
```
✓ Import complete — 14 students updated, 3 names skipped (no mapping)

ahmed@uni.edu     5 days · 47 events · 2h 15m estimated active time
sara@uni.edu      7 days · 83 events · 4h 02m estimated active time
```

"Upload another file" button resets to State 1.

---

## EALT Algorithm (Estimated Active Learning Time)

Runs per student, per day, on all events for that user on that date.

```
1. Collect all events for this student on this date
2. Sort by timestamp ascending
3. Walk through events in order:
   a. Compute gap to next event
   b. If gap ≤ 30 min → same session, add min(gap, 10) minutes to session time
   c. If gap > 30 min → close current session, start new session
4. Result: number_of_sessions, total_active_minutes,
           longest_session_minutes, session_durations[]
```

- **30-min gap** = session boundary (standard learning analytics convention)
- **10-min cap** per event = prevents idle time inflating estimates
- Final label in UI: "Estimated active engagement: Xh Ym" (not "Student spent...")

---

## Event Classification

Uses the `Component` column from the CSV:

| Component value | lms_sessions column |
|----------------|---------------------|
| `Quiz` | `exercise_practice_events++` |
| `Assignment` | `assignment_work_events++` |
| `Forum` + event name contains "created" or "posted" | `forum_posts++` |
| `Forum` (other) | `forum_views++` |
| Anything else | `total_events++` only |

All events count toward `total_events` regardless of type.

---

## Post-Import Pipeline

After upserting `lms_sessions` for all affected students, the import triggers
the same downstream pipeline as Moodle sync:

```
computeJudgments(pool, userId)    → regenerates LMS annotation sentences
computeAllScores(pool, userId)    → re-runs full PGMoE scoring pipeline
```

Both functions are already used by `syncUserFromMoodle` — CSV import reuses
them without modification.

---

## New Backend Files

- `backend/services/csvLogService.js` — CSV parsing, EALT algorithm, event classification, DB writes
- `backend/routes/csvLog.js` — 5 admin-only route handlers

## Modified Files

- `backend/routes/index.js` — mount new csvLog router
- `backend/migrations/` — new migration for `csv_log_uploads` + `csv_participant_aliases`
- `src/components/AdminCsvLogPanel.tsx` — new frontend component (new file)
- `src/api/csvLog.ts` — API client functions for the new endpoints (new file)
- Admin page component — add `<AdminCsvLogPanel />` panel

---

## What's Explicitly Out of Scope

- Automatic scheduled imports (upload is always manual)
- Role detection from the CSV (unmapped names are simply skipped)
- Storing original real names in any student-facing surface
- Parsing the `Description` column (Component is sufficient for classification)
