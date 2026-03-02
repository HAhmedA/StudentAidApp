# Moodle CSV Activity Log Upload — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow an admin to upload a Moodle course activity log CSV, pair participant names to app student emails via a dual-list UI, and import the data into `lms_sessions` using the EALT session algorithm.

**Architecture:** Two-step flow — upload extracts participant names and stores the raw CSV; admin uses a persistent pairing UI to map CSV names → app users; import processes the stored CSV using the current mapping and upserts into `lms_sessions` identically to Moodle sync. Pure service layer in `csvLogService.js`; routes in `csvLog.js`; UI in `AdminCsvLogPanel.tsx`.

**Tech Stack:** Node.js ESM, Express (`express.raw()` for file upload — no multer needed), PostgreSQL (pg pool), React + TypeScript. No new npm packages required.

---

## Reference: Existing patterns to follow

- **DB upsert pattern**: `backend/services/moodleService.js:454–504` (the `syncUserFromMoodle` transaction block)
- **Admin route pattern**: `backend/routes/lms.js` (all routes use `asyncRoute` + `requireAdmin`)
- **API client pattern**: `src/api/lms.ts` (all functions use `api.get/post/delete` from `src/api/client.ts`)
- **Admin UI pattern**: `src/components/AdminStudentViewer.tsx`
- **Route mounting**: `backend/routes/index.js`
- **Test pattern**: ESM mocks with `jest.unstable_mockModule` — see `backend/tests/scoring/`
- **Run tests**: `cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage`

---

## Task 1: DB Migration

**Files:**
- Create: `backend/migrations/1650000000017_csv-log.sql`

**Step 1: Create the migration file**

```sql
-- CSV Log Upload Schema
-- Stores uploaded Moodle activity log CSVs and persistent name→user mappings.

-- =============================================================================
-- CSV LOG UPLOADS (one row per uploaded file)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.csv_log_uploads (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  uploaded_by      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  filename         text NOT NULL,
  csv_content      text NOT NULL,
  row_count        int  NOT NULL DEFAULT 0,
  date_range_start date NULL,
  date_range_end   date NULL,
  status           text NOT NULL DEFAULT 'pending',
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  imported_at      timestamptz NULL,

  CONSTRAINT csv_log_uploads_status_check CHECK (status IN ('pending', 'imported', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_csv_log_uploads_admin
  ON public.csv_log_uploads (uploaded_by, uploaded_at DESC);

-- =============================================================================
-- CSV PARTICIPANT ALIASES (persistent name → user mapping)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.csv_participant_aliases (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  csv_name   text NOT NULL,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT csv_participant_aliases_name_unique UNIQUE (csv_name)
);

CREATE INDEX IF NOT EXISTS idx_csv_participant_aliases_user
  ON public.csv_participant_aliases (user_id);
```

**Step 2: Run the migration**

```bash
cd backend && npm run migrate
```

Expected: `Migrations run: 1650000000017_csv-log`

**Step 3: Verify tables exist**

```bash
# In psql or your DB client:
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'csv_%';
```

Expected: `csv_log_uploads`, `csv_participant_aliases`

**Step 4: Commit**

```bash
git add backend/migrations/1650000000017_csv-log.sql
git commit -m "feat: add csv_log_uploads and csv_participant_aliases tables"
```

---

## Task 2: CSV Parsing & EALT Service — Pure Functions

**Files:**
- Create: `backend/services/csvLogService.js`
- Create: `backend/tests/csvLogService.test.js`

**Step 1: Write failing tests for the pure functions**

Create `backend/tests/csvLogService.test.js`:

```js
// Tests for pure functions in csvLogService.js
// These functions have no DB or file I/O — easy to test.

import {
    parseCsv,
    extractUniqueNames,
    classifyComponent,
    computeEalt,
    aggregateCsvToDaily,
} from '../services/csvLogService.js'

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------
describe('parseCsv', () => {
    it('parses header + data rows into objects', () => {
        const csv = `Time,User full name,Component,Event name\n"1 Jan 2026, 10:00",Ahmed Al-Rashid,Quiz,Quiz attempt started`
        const rows = parseCsv(csv)
        expect(rows).toHaveLength(1)
        expect(rows[0]['User full name']).toBe('Ahmed Al-Rashid')
        expect(rows[0]['Component']).toBe('Quiz')
    })

    it('handles quoted fields with commas inside', () => {
        const csv = `Time,User full name\n"2 March 2026, 9:03:17 PM",Ahmed Al-Rashid`
        const rows = parseCsv(csv)
        expect(rows[0]['Time']).toBe('2 March 2026, 9:03:17 PM')
    })

    it('returns empty array for header-only CSV', () => {
        const rows = parseCsv(`Time,User full name,Component,Event name\n`)
        expect(rows).toHaveLength(0)
    })
})

// ---------------------------------------------------------------------------
// extractUniqueNames
// ---------------------------------------------------------------------------
describe('extractUniqueNames', () => {
    it('returns sorted unique values from User full name column', () => {
        const rows = [
            { 'User full name': 'Sara Malik' },
            { 'User full name': 'Ahmed Al-Rashid' },
            { 'User full name': 'Sara Malik' },
        ]
        expect(extractUniqueNames(rows)).toEqual(['Ahmed Al-Rashid', 'Sara Malik'])
    })

    it('excludes empty names', () => {
        const rows = [{ 'User full name': '' }, { 'User full name': 'Ahmed' }]
        expect(extractUniqueNames(rows)).toEqual(['Ahmed'])
    })
})

// ---------------------------------------------------------------------------
// classifyComponent
// ---------------------------------------------------------------------------
describe('classifyComponent', () => {
    it('maps Quiz to exercise_practice_events', () => {
        expect(classifyComponent('Quiz', 'Quiz attempt started'))
            .toEqual({ exercise_practice_events: 1 })
    })

    it('maps Assignment to assignment_work_events', () => {
        expect(classifyComponent('Assignment', 'Submission created'))
            .toEqual({ assignment_work_events: 1 })
    })

    it('maps Forum + created event to forum_posts', () => {
        expect(classifyComponent('Forum', 'Post created'))
            .toEqual({ forum_posts: 1 })
    })

    it('maps Forum + other event to forum_views', () => {
        expect(classifyComponent('Forum', 'Discussion viewed'))
            .toEqual({ forum_views: 1 })
    })

    it('returns empty object for unknown component', () => {
        expect(classifyComponent('System', 'User list viewed')).toEqual({})
    })
})

// ---------------------------------------------------------------------------
// computeEalt
// ---------------------------------------------------------------------------
describe('computeEalt', () => {
    const ts = (offsetMin) => new Date(Date.UTC(2026, 2, 1, 9, 0) + offsetMin * 60000)

    it('returns zero metrics for empty event list', () => {
        const result = computeEalt([])
        expect(result.number_of_sessions).toBe(0)
        expect(result.total_active_minutes).toBe(0)
        expect(result.longest_session_minutes).toBe(0)
        expect(result.session_durations).toEqual([])
    })

    it('counts a single event as one session with 0 minutes', () => {
        const result = computeEalt([{ timestamp: ts(0) }])
        expect(result.number_of_sessions).toBe(1)
        expect(result.total_active_minutes).toBe(0)
    })

    it('caps per-event gap at 10 minutes', () => {
        // Two events 60 min apart — should be capped at 10 min, NOT 60
        const events = [{ timestamp: ts(0) }, { timestamp: ts(60) }]
        // Gap > 30 min → two sessions; first session contributes 10 min (capped)
        const result = computeEalt(events)
        expect(result.number_of_sessions).toBe(2)
        expect(result.total_active_minutes).toBe(10)
    })

    it('merges events within 30-min window into one session', () => {
        const events = [
            { timestamp: ts(0) },
            { timestamp: ts(5) },
            { timestamp: ts(10) },
        ]
        const result = computeEalt(events)
        expect(result.number_of_sessions).toBe(1)
        // gaps: 5 + 5 = 10 min
        expect(result.total_active_minutes).toBe(10)
    })

    it('splits into two sessions when gap exceeds 30 min', () => {
        const events = [
            { timestamp: ts(0) },
            { timestamp: ts(5) },
            { timestamp: ts(40) }, // > 30 min gap → new session
            { timestamp: ts(45) },
        ]
        const result = computeEalt(events)
        expect(result.number_of_sessions).toBe(2)
    })

    it('longest_session_minutes reflects the longer session', () => {
        const events = [
            { timestamp: ts(0) },
            { timestamp: ts(10) },  // session 1: 10 min gap (capped at 10)
            { timestamp: ts(50) },  // new session (>30 gap)
            { timestamp: ts(53) },  // session 2: 3 min gap
        ]
        const result = computeEalt(events)
        expect(result.number_of_sessions).toBe(2)
        expect(result.longest_session_minutes).toBe(10)
    })
})

// ---------------------------------------------------------------------------
// aggregateCsvToDaily
// ---------------------------------------------------------------------------
describe('aggregateCsvToDaily', () => {
    it('groups events by date and returns one row per day', () => {
        const rows = [
            { 'User full name': 'Ahmed', 'Time': '1 March 2026, 10:00:00 AM', 'Component': 'Quiz', 'Event name': 'Quiz attempt started' },
            { 'User full name': 'Ahmed', 'Time': '1 March 2026, 10:15:00 AM', 'Component': 'Forum', 'Event name': 'Post created' },
            { 'User full name': 'Ahmed', 'Time': '2 March 2026, 09:00:00 AM', 'Component': 'Assignment', 'Event name': 'Submission created' },
        ]
        const result = aggregateCsvToDaily('Ahmed', rows)
        expect(result).toHaveLength(2)
        const march1 = result.find(r => r.session_date === '2026-03-01')
        expect(march1.exercise_practice_events).toBe(1)
        expect(march1.forum_posts).toBe(1)
        const march2 = result.find(r => r.session_date === '2026-03-02')
        expect(march2.assignment_work_events).toBe(1)
    })
})
```

**Step 2: Run tests — verify they all FAIL**

```bash
cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage tests/csvLogService.test.js
```

Expected: FAIL — `Cannot find module '../services/csvLogService.js'`

**Step 3: Implement the pure functions**

Create `backend/services/csvLogService.js`:

```js
// CSV Log Service
// Parses Moodle activity log CSV exports, computes EALT session metrics,
// classifies events by Component, and writes to lms_sessions.

import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { withTransaction } from '../utils/withTransaction.js'
import { computeAllScores } from './scoring/index.js'
import { computeJudgments } from './annotators/lmsAnnotationService.js'

// =============================================================================
// CSV PARSING
// =============================================================================

/**
 * Parse a CSV line respecting quoted fields (handles commas inside quotes).
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
    const result = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') {
            inQuotes = !inQuotes
        } else if (ch === ',' && !inQuotes) {
            result.push(current)
            current = ''
        } else {
            current += ch
        }
    }
    result.push(current)
    return result
}

/**
 * Parse a full CSV string into an array of row objects keyed by header.
 * @param {string} text - Raw CSV content
 * @returns {Object[]}
 */
function parseCsv(text) {
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length < 2) return []

    const headers = parseCsvLine(lines[0]).map(h => h.trim())
    return lines.slice(1).map(line => {
        const values = parseCsvLine(line)
        const row = {}
        headers.forEach((h, i) => { row[h] = (values[i] ?? '').trim() })
        return row
    }).filter(row => Object.values(row).some(v => v !== ''))
}

/**
 * Extract sorted unique participant names from parsed CSV rows.
 * @param {Object[]} rows
 * @returns {string[]}
 */
function extractUniqueNames(rows) {
    const names = new Set(
        rows
            .map(r => r['User full name'])
            .filter(n => n && n.trim())
    )
    return [...names].sort()
}

// =============================================================================
// EVENT CLASSIFICATION
// =============================================================================

/**
 * Classify a Moodle event into lms_sessions metric buckets by Component.
 * @param {string} component - Value of the "Component" CSV column
 * @param {string} eventName - Value of the "Event name" CSV column
 * @returns {Object} - Partial lms_sessions metric increments
 */
function classifyComponent(component, eventName) {
    switch (component) {
        case 'Quiz':
            return { exercise_practice_events: 1 }
        case 'Assignment':
            return { assignment_work_events: 1 }
        case 'Forum': {
            const lower = (eventName || '').toLowerCase()
            if (lower.includes('created') || lower.includes('posted')) {
                return { forum_posts: 1 }
            }
            return { forum_views: 1 }
        }
        default:
            return {}
    }
}

// =============================================================================
// EALT ALGORITHM (Estimated Active Learning Time)
// =============================================================================

const SESSION_GAP_MS  = 30 * 60 * 1000  // 30 min → new session boundary
const EVENT_CAP_MIN   = 10               // max minutes credited per event gap

/**
 * Compute EALT session metrics from a list of timestamped events.
 *
 * Algorithm:
 *   - Sort events by timestamp
 *   - Walk through; gap to next event:
 *       <= 30 min: same session, add min(gap, 10) minutes
 *       >  30 min: close session, start new one
 *   - Last event in each session adds 0 minutes (no "next" event)
 *
 * @param {{ timestamp: Date }[]} events
 * @returns {{ number_of_sessions, total_active_minutes, longest_session_minutes, session_durations }}
 */
function computeEalt(events) {
    if (events.length === 0) {
        return {
            number_of_sessions: 0,
            total_active_minutes: 0,
            longest_session_minutes: 0,
            session_durations: []
        }
    }

    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)
    const sessionDurations = []
    let currentSessionMin = 0

    for (let i = 0; i < sorted.length; i++) {
        const next = sorted[i + 1]

        if (!next) {
            // Last event in current session — close it
            sessionDurations.push(Math.round(currentSessionMin))
            break
        }

        const gapMs  = next.timestamp - sorted[i].timestamp
        const gapMin = gapMs / 60000

        if (gapMs > SESSION_GAP_MS) {
            // Gap too large — close session, start new one
            // Still credit capped time for this event
            currentSessionMin += EVENT_CAP_MIN
            sessionDurations.push(Math.round(currentSessionMin))
            currentSessionMin = 0
        } else {
            // Same session — credit actual gap (capped at EVENT_CAP_MIN)
            currentSessionMin += Math.min(gapMin, EVENT_CAP_MIN)
        }
    }

    const total   = sessionDurations.reduce((s, d) => s + d, 0)
    const longest = sessionDurations.length > 0 ? Math.max(...sessionDurations) : 0

    return {
        number_of_sessions:     sessionDurations.length,
        total_active_minutes:   total,
        longest_session_minutes: longest,
        session_durations:      sessionDurations
    }
}

// =============================================================================
// AGGREGATION: CSV ROWS → DAILY lms_sessions SHAPE
// =============================================================================

/**
 * Parse a Moodle timestamp string into a Date.
 * Moodle exports timestamps like: "2 March 2026, 9:03:17 PM"
 * @param {string} timeStr
 * @returns {Date|null}
 */
function parseMoodleTime(timeStr) {
    if (!timeStr) return null
    const d = new Date(timeStr.replace(',', ''))
    return isNaN(d.getTime()) ? null : d
}

/**
 * Format a Date to YYYY-MM-DD string.
 * @param {Date} d
 * @returns {string}
 */
function toDateString(d) {
    return d.toISOString().slice(0, 10)
}

/**
 * Aggregate CSV rows for a specific participant into daily lms_sessions rows.
 * @param {string} csvName - The "User full name" value to filter by
 * @param {Object[]} rows  - All parsed CSV rows
 * @returns {Object[]} - One object per active day, shaped for lms_sessions upsert
 */
function aggregateCsvToDaily(csvName, rows) {
    // Filter to this participant's rows and parse timestamps
    const userEvents = rows
        .filter(r => r['User full name'] === csvName)
        .map(r => ({
            timestamp: parseMoodleTime(r['Time']),
            component: r['Component'] || '',
            eventName: r['Event name'] || ''
        }))
        .filter(e => e.timestamp !== null)

    if (userEvents.length === 0) return []

    // Group by date
    const byDate = {}
    for (const event of userEvents) {
        const date = toDateString(event.timestamp)
        if (!byDate[date]) byDate[date] = []
        byDate[date].push(event)
    }

    return Object.entries(byDate).map(([date, events]) => {
        const ealt = computeEalt(events)

        // Accumulate metric counters
        const counters = {
            exercise_practice_events: 0,
            assignment_work_events:   0,
            forum_views:              0,
            forum_posts:              0,
        }
        for (const event of events) {
            const inc = classifyComponent(event.component, event.eventName)
            for (const [k, v] of Object.entries(inc)) {
                counters[k] = (counters[k] || 0) + v
            }
        }

        return {
            session_date:              date,
            total_active_minutes:      ealt.total_active_minutes,
            total_events:              events.length,
            number_of_sessions:        ealt.number_of_sessions,
            longest_session_minutes:   ealt.longest_session_minutes,
            days_active_in_period:     1,
            reading_minutes:           0,
            watching_minutes:          0,
            exercise_practice_events:  counters.exercise_practice_events,
            assignment_work_events:    counters.assignment_work_events,
            forum_views:               counters.forum_views,
            forum_posts:               counters.forum_posts,
            session_durations:         ealt.session_durations,
        }
    })
}

// =============================================================================
// EXPORTS (pure functions — exported for testing)
// =============================================================================

export {
    parseCsv,
    extractUniqueNames,
    classifyComponent,
    computeEalt,
    aggregateCsvToDaily,
}

// =============================================================================
// DB OPERATIONS (not exported — used by route handlers below)
// =============================================================================

/**
 * Upsert daily lms_sessions rows for one user (same transaction pattern as moodleService).
 * @param {import('pg').PoolClient} client - Transaction client
 * @param {string} userId
 * @param {Object[]} dailyRows
 */
async function upsertSessionRows(client, userId, dailyRows) {
    for (const row of dailyRows) {
        await client.query(
            `INSERT INTO public.lms_sessions
                 (user_id, session_date, total_active_minutes, total_events,
                  number_of_sessions, longest_session_minutes, days_active_in_period,
                  reading_minutes, watching_minutes, exercise_practice_events,
                  assignment_work_events, forum_views, forum_posts,
                  session_durations, is_simulated)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             ON CONFLICT (user_id, session_date) DO UPDATE SET
                 total_active_minutes     = EXCLUDED.total_active_minutes,
                 total_events             = EXCLUDED.total_events,
                 number_of_sessions       = EXCLUDED.number_of_sessions,
                 longest_session_minutes  = EXCLUDED.longest_session_minutes,
                 reading_minutes          = EXCLUDED.reading_minutes,
                 watching_minutes         = EXCLUDED.watching_minutes,
                 exercise_practice_events = EXCLUDED.exercise_practice_events,
                 assignment_work_events   = EXCLUDED.assignment_work_events,
                 forum_views              = EXCLUDED.forum_views,
                 forum_posts              = EXCLUDED.forum_posts,
                 session_durations        = EXCLUDED.session_durations,
                 is_simulated             = EXCLUDED.is_simulated`,
            [
                userId, row.session_date,
                row.total_active_minutes, row.total_events,
                row.number_of_sessions, row.longest_session_minutes,
                row.days_active_in_period, row.reading_minutes, row.watching_minutes,
                row.exercise_practice_events, row.assignment_work_events,
                row.forum_views, row.forum_posts,
                JSON.stringify(row.session_durations), false
            ]
        )
    }

    // Recompute baseline (same query as moodleService)
    await client.query(
        `WITH baseline_data AS (
             SELECT COALESCE(AVG(total_active_minutes), 0) AS avg_min,
                    COALESCE(AVG(number_of_sessions), 0)   AS avg_sessions,
                    COUNT(DISTINCT session_date)            AS active_days
             FROM public.lms_sessions
             WHERE user_id = $1
               AND is_simulated = false
               AND session_date >= CURRENT_DATE - INTERVAL '7 days'
         )
         INSERT INTO public.lms_baselines
             (user_id, baseline_active_minutes, baseline_sessions, baseline_days_active)
         SELECT $1, avg_min, avg_sessions, active_days FROM baseline_data
         ON CONFLICT (user_id) DO UPDATE SET
             baseline_active_minutes = EXCLUDED.baseline_active_minutes,
             baseline_sessions       = EXCLUDED.baseline_sessions,
             baseline_days_active    = EXCLUDED.baseline_days_active`,
        [userId]
    )
}

/**
 * Process a stored upload: read CSV, apply mappings, upsert sessions, recompute scores.
 * @param {string} uploadId
 * @returns {{ imported: number, skipped: number, details: Object[] }}
 */
async function processUpload(uploadId) {
    // 1. Load upload
    const { rows: uploadRows } = await pool.query(
        `SELECT id, csv_content FROM public.csv_log_uploads WHERE id = $1`,
        [uploadId]
    )
    if (uploadRows.length === 0) throw new Error(`Upload ${uploadId} not found`)
    const csvContent = uploadRows[0].csv_content

    // 2. Load all mappings
    const { rows: mappings } = await pool.query(
        `SELECT cpa.csv_name, cpa.user_id, u.email
         FROM public.csv_participant_aliases cpa
         JOIN public.users u ON u.id = cpa.user_id`
    )
    if (mappings.length === 0) {
        return { imported: 0, skipped: 0, details: [] }
    }

    // 3. Parse CSV
    const rows = parseCsv(csvContent)

    // 4. Process each mapped participant
    const details = []
    let imported = 0
    let skipped  = 0

    for (const mapping of mappings) {
        const dailyRows = aggregateCsvToDaily(mapping.csv_name, rows)
        if (dailyRows.length === 0) {
            skipped++
            details.push({ csvName: mapping.csv_name, email: mapping.email, daysUpdated: 0, totalEvents: 0 })
            continue
        }

        await withTransaction(pool, async (client) => {
            await upsertSessionRows(client, mapping.user_id, dailyRows)
        })

        // Fire-and-forget — same pattern as moodleService
        computeAllScores(mapping.user_id).catch(err =>
            logger.error(`CSV import: computeAllScores error for ${mapping.user_id}: ${err.message}`)
        )
        computeJudgments(pool, mapping.user_id).catch(err =>
            logger.error(`CSV import: computeJudgments error for ${mapping.user_id}: ${err.message}`)
        )

        const totalEvents = dailyRows.reduce((s, r) => s + r.total_events, 0)
        imported++
        details.push({
            csvName:     mapping.csv_name,
            email:       mapping.email,
            daysUpdated: dailyRows.length,
            totalEvents,
        })
        logger.info(`CSV import: ${mapping.csv_name} → ${mapping.email}: ${dailyRows.length} days, ${totalEvents} events`)
    }

    // 5. Mark upload as imported
    await pool.query(
        `UPDATE public.csv_log_uploads SET status = 'imported', imported_at = NOW() WHERE id = $1`,
        [uploadId]
    )

    return { imported, skipped, details }
}

export { processUpload }
```

**Step 4: Run tests — verify they all PASS**

```bash
cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage tests/csvLogService.test.js
```

Expected: all tests PASS

**Step 5: Run full test suite to confirm no regressions**

```bash
cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage
```

Expected: 179+ tests passing, 0 failures

**Step 6: Commit**

```bash
git add backend/services/csvLogService.js backend/tests/csvLogService.test.js
git commit -m "feat: add csvLogService with EALT algorithm, CSV parser, and event classifier"
```

---

## Task 3: Backend Route Handler

**Files:**
- Create: `backend/routes/csvLog.js`

**Step 1: Create the route file**

```js
// CSV Log Admin Routes
// All routes require admin privileges.
// File upload uses express.raw() — no multer dependency.

import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAdmin } from '../middleware/auth.js'
import { asyncRoute, Errors } from '../utils/errors.js'
import { parseCsv, extractUniqueNames, processUpload } from '../services/csvLogService.js'

const router = Router()
router.use(requireAdmin)

// =============================================================================
// UPLOAD CSV
// POST /api/lms/admin/csv/upload
// Content-Type: text/csv  (raw body — no multipart)
// Header: X-Filename: <original filename>
// =============================================================================
router.post(
    '/upload',
    // express.raw parses the raw CSV bytes for this route only
    (req, res, next) => {
        const rawMiddleware = require('express').raw({ type: 'text/csv', limit: '10mb' })
        rawMiddleware(req, res, next)
    },
    asyncRoute(async (req, res) => {
        const csvContent = req.body?.toString('utf8') || ''
        if (!csvContent.trim()) throw Errors.VALIDATION('CSV body is empty')

        const filename = req.headers['x-filename'] || 'upload.csv'
        const adminId  = req.session.user.id

        // Parse to extract metadata
        const rows = parseCsv(csvContent)
        if (rows.length === 0) throw Errors.VALIDATION('CSV has no data rows')

        const csvNames = extractUniqueNames(rows)

        // Detect date range from Time column
        const times = rows
            .map(r => new Date(r['Time']?.replace(',', '') || ''))
            .filter(d => !isNaN(d.getTime()))
            .sort((a, b) => a - b)
        const dateRangeStart = times.length > 0 ? times[0].toISOString().slice(0, 10) : null
        const dateRangeEnd   = times.length > 0 ? times[times.length - 1].toISOString().slice(0, 10) : null

        // Store upload
        const { rows: insertRows } = await pool.query(
            `INSERT INTO public.csv_log_uploads
                 (uploaded_by, filename, csv_content, row_count, date_range_start, date_range_end)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [adminId, filename, csvContent, rows.length, dateRangeStart, dateRangeEnd]
        )
        const uploadId = insertRows[0].id

        // Load existing mappings for the names in this CSV
        const { rows: mappingRows } = await pool.query(
            `SELECT cpa.csv_name, cpa.user_id, u.email
             FROM public.csv_participant_aliases cpa
             JOIN public.users u ON u.id = cpa.user_id
             WHERE cpa.csv_name = ANY($1)`,
            [csvNames]
        )
        const existingMappings = {}
        for (const m of mappingRows) {
            existingMappings[m.csv_name] = { userId: m.user_id, email: m.email }
        }

        logger.info(`CSV upload by admin ${adminId}: ${rows.length} rows, ${csvNames.length} participants`)

        res.status(201).json({
            uploadId,
            rowCount: rows.length,
            dateRange: { start: dateRangeStart, end: dateRangeEnd },
            csvNames,
            existingMappings,
        })
    })
)

// =============================================================================
// GET ALL MAPPINGS
// GET /api/lms/admin/csv/participants
// =============================================================================
router.get('/participants', asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
        `SELECT cpa.id, cpa.csv_name, cpa.user_id, u.email, cpa.created_at
         FROM public.csv_participant_aliases cpa
         JOIN public.users u ON u.id = cpa.user_id
         ORDER BY cpa.csv_name`
    )
    res.json({ mappings: rows })
}))

// =============================================================================
// CREATE/UPDATE MAPPING
// POST /api/lms/admin/csv/mapping
// Body: { csvName: string, userId: string }
// =============================================================================
router.post('/mapping', asyncRoute(async (req, res) => {
    const { csvName, userId } = req.body
    if (!csvName || typeof csvName !== 'string') throw Errors.VALIDATION('csvName is required')
    if (!userId  || typeof userId  !== 'string') throw Errors.VALIDATION('userId is required')

    // Verify the user exists and is a student
    const { rows: userRows } = await pool.query(
        `SELECT id, email FROM public.users WHERE id = $1 AND role = 'student'`,
        [userId]
    )
    if (userRows.length === 0) throw Errors.NOT_FOUND('Student user')

    const { rows } = await pool.query(
        `INSERT INTO public.csv_participant_aliases (csv_name, user_id)
         VALUES ($1, $2)
         ON CONFLICT (csv_name) DO UPDATE SET user_id = EXCLUDED.user_id
         RETURNING id, csv_name, user_id`,
        [csvName.trim(), userId]
    )
    res.status(201).json({ mapping: { ...rows[0], email: userRows[0].email } })
}))

// =============================================================================
// DELETE MAPPING
// DELETE /api/lms/admin/csv/mapping/:csvName
// :csvName is URL-encoded
// =============================================================================
router.delete('/mapping/:csvName', asyncRoute(async (req, res) => {
    const csvName = decodeURIComponent(req.params.csvName)
    const { rowCount } = await pool.query(
        `DELETE FROM public.csv_participant_aliases WHERE csv_name = $1`,
        [csvName]
    )
    if (rowCount === 0) throw Errors.NOT_FOUND('Mapping')
    res.json({ deleted: true, csvName })
}))

// =============================================================================
// IMPORT
// POST /api/lms/admin/csv/import/:uploadId
// =============================================================================
router.post('/import/:uploadId', asyncRoute(async (req, res) => {
    const { uploadId } = req.params

    // Verify upload exists and is pending
    const { rows: uploadRows } = await pool.query(
        `SELECT id, status FROM public.csv_log_uploads WHERE id = $1`,
        [uploadId]
    )
    if (uploadRows.length === 0) throw Errors.NOT_FOUND('CSV upload')
    if (uploadRows[0].status === 'imported') {
        throw Errors.VALIDATION('This upload has already been imported. Upload a new file to import again.')
    }

    logger.info(`CSV import started: uploadId=${uploadId}`)
    const result = await processUpload(uploadId)
    logger.info(`CSV import complete: ${result.imported} imported, ${result.skipped} skipped`)

    res.json(result)
}))

export default router
```

**NOTE on `express.raw()`:** The middleware inside the upload route uses a dynamic `require('express')` which won't work in ESM. Fix by importing `express` at the top and using it directly. The corrected import section:

```js
import express from 'express'
// ...and change the middleware line to:
express.raw({ type: 'text/csv', limit: '10mb' })(req, res, next)
```

**Step 2: Commit**

```bash
git add backend/routes/csvLog.js
git commit -m "feat: add CSV log admin routes (upload, mapping CRUD, import)"
```

---

## Task 4: Mount the Router

**Files:**
- Modify: `backend/routes/index.js`

**Step 1: Add the import and mount**

In `backend/routes/index.js`, add after the lms import line:

```js
import csvLogRoutes from './csvLog.js'
```

And after `router.use('/lms', lmsRoutes)`:

```js
router.use('/lms', csvLogRoutes)
```

The CSV routes will be accessible at `/api/lms/admin/csv/...` (consistent with existing LMS admin routes).

**Step 2: Verify the server starts**

```bash
cd backend && node server.js
```

Expected: server starts without error. Check `GET /api/lms/admin/csv/participants` returns 401 without auth.

**Step 3: Run full test suite**

```bash
cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage
```

Expected: all tests still passing.

**Step 4: Commit**

```bash
git add backend/routes/index.js
git commit -m "feat: mount csvLog router at /api/lms"
```

---

## Task 5: Frontend API Client

**Files:**
- Create: `src/api/csvLog.ts`

**Step 1: Create the API client**

```ts
// CSV Log API client — admin-only endpoints for Moodle activity log CSV upload.
// File upload uses raw fetch (not api.post) because we need to send text/csv body,
// not JSON. All other calls use the standard api client.

import { api } from './client'

// -- Types --

export interface CsvUploadResult {
    uploadId: string
    rowCount: number
    dateRange: { start: string | null; end: string | null }
    csvNames: string[]
    existingMappings: Record<string, { userId: string; email: string }>
}

export interface CsvMapping {
    id: string
    csv_name: string
    user_id: string
    email: string
    created_at: string
}

export interface CsvImportDetail {
    csvName: string
    email: string
    daysUpdated: number
    totalEvents: number
}

export interface CsvImportResult {
    imported: number
    skipped: number
    details: CsvImportDetail[]
}

// -- API functions --

/**
 * Upload a CSV file as raw text/csv body.
 * Returns extracted participant names and existing mappings.
 */
export async function uploadCsvLog(file: File): Promise<CsvUploadResult> {
    const text = await file.text()
    const res = await fetch('/api/lms/admin/csv/upload', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'text/csv',
            'X-Filename': file.name,
        },
        body: text,
    })
    if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as any).message || 'Upload failed')
    }
    return res.json()
}

/**
 * Get all persistent name→email mappings.
 */
export const getCsvMappings = () =>
    api.get<{ mappings: CsvMapping[] }>('/lms/admin/csv/participants')

/**
 * Create or update a mapping (csv_name → userId).
 */
export const createCsvMapping = (csvName: string, userId: string) =>
    api.post<{ mapping: CsvMapping }>('/lms/admin/csv/mapping', { csvName, userId })

/**
 * Delete a mapping by CSV name.
 */
export const deleteCsvMapping = (csvName: string) =>
    api.delete<{ deleted: boolean; csvName: string }>(
        `/lms/admin/csv/mapping/${encodeURIComponent(csvName)}`
    )

/**
 * Trigger import for a stored upload using current mappings.
 */
export const importCsvLog = (uploadId: string) =>
    api.post<CsvImportResult>(`/lms/admin/csv/import/${uploadId}`, {})
```

**Step 2: Commit**

```bash
git add src/api/csvLog.ts
git commit -m "feat: add csvLog TypeScript API client"
```

---

## Task 6: Frontend Component

**Files:**
- Create: `src/components/AdminCsvLogPanel.tsx`

**Step 1: Create the component**

```tsx
// AdminCsvLogPanel — Moodle CSV activity log upload and participant mapping UI.
// Three phases: Upload → Mapping → Import Result.

import { useState, useEffect } from 'react'
import {
    uploadCsvLog, getCsvMappings, createCsvMapping, deleteCsvMapping, importCsvLog,
    type CsvUploadResult, type CsvMapping, type CsvImportResult
} from '../api/csvLog'

// -- Types --

interface AppStudent {
    id: string
    email: string
    name: string
}

type Phase = 'upload' | 'mapping' | 'result'

// -- Component --

const AdminCsvLogPanel = () => {
    const [phase, setPhase]           = useState<Phase>('upload')
    const [uploading, setUploading]   = useState(false)
    const [uploadError, setUploadError] = useState<string | null>(null)
    const [uploadResult, setUploadResult] = useState<CsvUploadResult | null>(null)

    // Mapping state
    const [appStudents, setAppStudents]   = useState<AppStudent[]>([])
    const [mappings, setMappings]         = useState<CsvMapping[]>([])
    const [selectedEmail, setSelectedEmail] = useState<string | null>(null)
    const [selectedCsvName, setSelectedCsvName] = useState<string | null>(null)
    const [searchA, setSearchA]           = useState('')
    const [searchB, setSearchB]           = useState('')
    const [pairLoading, setPairLoading]   = useState(false)

    // Import state
    const [importing, setImporting]         = useState(false)
    const [importResult, setImportResult]   = useState<CsvImportResult | null>(null)
    const [importError, setImportError]     = useState<string | null>(null)

    // Load app students and existing mappings on mount
    useEffect(() => {
        fetch('/api/admin/students', { credentials: 'include' })
            .then(r => r.json())
            .then(d => setAppStudents(d.students || []))
            .catch(() => {})

        getCsvMappings()
            .then(d => setMappings(d.mappings))
            .catch(() => {})
    }, [])

    // -- Derived sets --
    const pairedEmails   = new Set(mappings.map(m => m.user_id))
    const pairedCsvNames = new Set(mappings.map(m => m.csv_name))

    // CSV names from current upload (merge with mappings for full list B)
    const csvNames: string[] = uploadResult
        ? uploadResult.csvNames
        : [...new Set(mappings.map(m => m.csv_name))]

    const filteredStudents = appStudents.filter(
        s => !pairedEmails.has(s.id) && s.email.toLowerCase().includes(searchA.toLowerCase())
    )
    const filteredCsvNames = csvNames.filter(
        n => !pairedCsvNames.has(n) && n.toLowerCase().includes(searchB.toLowerCase())
    )

    // -- Handlers --

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setUploading(true)
        setUploadError(null)
        try {
            const result = await uploadCsvLog(file)
            setUploadResult(result)
            // Merge existing mappings returned in upload response
            const incoming = Object.entries(result.existingMappings).map(([csv_name, m]) => ({
                id: '', csv_name, user_id: m.userId, email: m.email, created_at: ''
            } as CsvMapping))
            setMappings(prev => {
                const existing = prev.filter(p => !result.existingMappings[p.csv_name])
                return [...existing, ...incoming]
            })
            setPhase('mapping')
        } catch (err: any) {
            setUploadError(err.message || 'Upload failed')
        } finally {
            setUploading(false)
        }
    }

    const handleMakePair = async () => {
        if (!selectedEmail || !selectedCsvName) return
        const student = appStudents.find(s => s.email === selectedEmail)
        if (!student) return

        setPairLoading(true)
        try {
            const result = await createCsvMapping(selectedCsvName, student.id)
            setMappings(prev => {
                const filtered = prev.filter(m => m.csv_name !== selectedCsvName)
                return [...filtered, result.mapping]
            })
            setSelectedEmail(null)
            setSelectedCsvName(null)
        } catch (err: any) {
            alert(`Could not create pair: ${err.message}`)
        } finally {
            setPairLoading(false)
        }
    }

    const handleDeletePair = async (csvName: string) => {
        try {
            await deleteCsvMapping(csvName)
            setMappings(prev => prev.filter(m => m.csv_name !== csvName))
        } catch (err: any) {
            alert(`Could not remove pair: ${err.message}`)
        }
    }

    const handleImport = async () => {
        if (!uploadResult) return
        setImporting(true)
        setImportError(null)
        try {
            const result = await importCsvLog(uploadResult.uploadId)
            setImportResult(result)
            setPhase('result')
        } catch (err: any) {
            setImportError(err.message || 'Import failed')
        } finally {
            setImporting(false)
        }
    }

    const handleReset = () => {
        setPhase('upload')
        setUploadResult(null)
        setImportResult(null)
        setUploadError(null)
        setImportError(null)
        setSelectedEmail(null)
        setSelectedCsvName(null)
    }

    const pairedCount = mappings.length

    // -- Render --

    return (
        <div className='admin-csv-panel'>
            <h3 className='admin-csv-title'>Moodle Activity Log Import</h3>

            {/* ── PHASE: Upload ── */}
            {phase === 'upload' && (
                <div className='admin-csv-upload-zone'>
                    <p className='admin-csv-hint'>
                        Export the course activity log from Moodle (CSV format) and upload it here.
                        Student names will be matched to app accounts using the mapping below.
                    </p>
                    <label className='admin-csv-file-label'>
                        <input
                            type='file'
                            accept='.csv'
                            onChange={handleFileChange}
                            disabled={uploading}
                            style={{ display: 'none' }}
                        />
                        {uploading ? 'Uploading...' : 'Choose CSV file'}
                    </label>
                    {uploadError && <p className='admin-csv-error'>{uploadError}</p>}

                    {/* Show existing mappings even before upload */}
                    {mappings.length > 0 && (
                        <div className='admin-csv-existing-note'>
                            {mappings.length} existing mapping{mappings.length !== 1 ? 's' : ''} will be reused automatically.
                            <button className='admin-csv-link-btn' onClick={() => setPhase('mapping')}>
                                Edit mappings →
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── PHASE: Mapping ── */}
            {phase === 'mapping' && (
                <div className='admin-csv-mapping'>
                    {uploadResult && (
                        <p className='admin-csv-meta'>
                            Uploaded: <strong>{uploadResult.rowCount} rows</strong>
                            {uploadResult.dateRange.start && (
                                <> · {uploadResult.dateRange.start} to {uploadResult.dateRange.end}</>
                            )}
                        </p>
                    )}

                    {/* Dual-list pairing UI */}
                    <div className='admin-csv-lists'>
                        {/* List A — App student emails */}
                        <div className='admin-csv-list'>
                            <div className='admin-csv-list-header'>App Students (email)</div>
                            <input
                                className='admin-csv-search'
                                placeholder='Search...'
                                value={searchA}
                                onChange={e => setSearchA(e.target.value)}
                            />
                            <div className='admin-csv-list-items'>
                                {filteredStudents.map(s => (
                                    <div
                                        key={s.id}
                                        className={`admin-csv-list-item ${selectedEmail === s.email ? 'selected' : ''}`}
                                        onClick={() => setSelectedEmail(
                                            selectedEmail === s.email ? null : s.email
                                        )}
                                    >
                                        {s.email}
                                    </div>
                                ))}
                                {filteredStudents.length === 0 && (
                                    <div className='admin-csv-empty'>All students paired</div>
                                )}
                            </div>
                        </div>

                        {/* List B — CSV participant names */}
                        <div className='admin-csv-list'>
                            <div className='admin-csv-list-header'>CSV Participants</div>
                            <input
                                className='admin-csv-search'
                                placeholder='Search...'
                                value={searchB}
                                onChange={e => setSearchB(e.target.value)}
                            />
                            <div className='admin-csv-list-items'>
                                {filteredCsvNames.map(name => (
                                    <div
                                        key={name}
                                        className={`admin-csv-list-item ${selectedCsvName === name ? 'selected' : ''}`}
                                        onClick={() => setSelectedCsvName(
                                            selectedCsvName === name ? null : name
                                        )}
                                    >
                                        {name}
                                    </div>
                                ))}
                                {filteredCsvNames.length === 0 && (
                                    <div className='admin-csv-empty'>No unmatched names</div>
                                )}
                            </div>
                        </div>
                    </div>

                    <button
                        className='admin-csv-pair-btn'
                        onClick={handleMakePair}
                        disabled={!selectedEmail || !selectedCsvName || pairLoading}
                    >
                        {pairLoading ? 'Pairing...' : 'Make Pair'}
                    </button>

                    {/* Pairs table */}
                    {mappings.length > 0 && (
                        <div className='admin-csv-pairs'>
                            <div className='admin-csv-pairs-header'>Pairs ({mappings.length})</div>
                            {mappings.map(m => (
                                <div key={m.csv_name} className='admin-csv-pair-row'>
                                    <span className='admin-csv-pair-email'>{m.email}</span>
                                    <span className='admin-csv-pair-arrow'>→</span>
                                    <span className='admin-csv-pair-name'>{m.csv_name}</span>
                                    <button
                                        className='admin-csv-pair-delete'
                                        onClick={() => handleDeletePair(m.csv_name)}
                                        title='Remove pair'
                                    >✕</button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Import button */}
                    {uploadResult && (
                        <div className='admin-csv-import-row'>
                            {importError && <p className='admin-csv-error'>{importError}</p>}
                            <button
                                className='admin-csv-import-btn'
                                onClick={handleImport}
                                disabled={importing || pairedCount === 0}
                            >
                                {importing
                                    ? 'Importing...'
                                    : `Import CSV (${pairedCount} paired student${pairedCount !== 1 ? 's' : ''})`}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── PHASE: Result ── */}
            {phase === 'result' && importResult && (
                <div className='admin-csv-result'>
                    <div className='admin-csv-result-summary'>
                        ✓ Import complete — {importResult.imported} student{importResult.imported !== 1 ? 's' : ''} updated,
                        {' '}{importResult.skipped} skipped (no data in file)
                    </div>
                    <div className='admin-csv-result-table'>
                        {importResult.details.filter(d => d.daysUpdated > 0).map(d => (
                            <div key={d.csvName} className='admin-csv-result-row'>
                                <span className='admin-csv-result-email'>{d.email}</span>
                                <span className='admin-csv-result-meta'>
                                    {d.daysUpdated} day{d.daysUpdated !== 1 ? 's' : ''} · {d.totalEvents} events
                                </span>
                            </div>
                        ))}
                    </div>
                    <button className='admin-csv-reset-btn' onClick={handleReset}>
                        Upload another file
                    </button>
                </div>
            )}
        </div>
    )
}

export default AdminCsvLogPanel
```

**Step 2: Commit**

```bash
git add src/components/AdminCsvLogPanel.tsx
git commit -m "feat: add AdminCsvLogPanel component with dual-list pairing UI"
```

---

## Task 7: Wire Component into Admin Page + Add CSS

**Files:**
- Modify: `src/pages/Home.tsx`
- Modify: `src/pages/Home.css` (or wherever admin styles live)

**Step 1: Import and render the new panel in `Home.tsx`**

Add the import at the top of `Home.tsx` with the other admin component imports:

```tsx
import AdminCsvLogPanel from '../components/AdminCsvLogPanel'
```

In the JSX, add `<AdminCsvLogPanel />` after `<AdminClusterDiagnosticsPanel />`:

```tsx
{/* CSV activity log upload panel */}
<AdminCsvLogPanel />
```

**Step 2: Add CSS**

Find the admin CSS file (check where `.admin-student-selector` is defined — likely `Home.css` or a separate admin CSS). Add the following styles:

```css
/* ── AdminCsvLogPanel ─────────────────────────────────────── */

.admin-csv-panel {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 16px;
}

.admin-csv-title {
    font-size: 15px;
    font-weight: 600;
    color: #1e293b;
    margin: 0 0 16px 0;
}

.admin-csv-hint {
    font-size: 13px;
    color: #6b7280;
    margin: 0 0 12px 0;
}

.admin-csv-file-label {
    display: inline-block;
    padding: 8px 16px;
    background: #3b82f6;
    color: white;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background 0.2s;
}

.admin-csv-file-label:hover { background: #2563eb; }

.admin-csv-error {
    color: #ef4444;
    font-size: 13px;
    margin: 8px 0 0;
}

.admin-csv-meta {
    font-size: 13px;
    color: #6b7280;
    margin: 0 0 12px;
}

.admin-csv-lists {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 12px;
}

.admin-csv-list {
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    overflow: hidden;
}

.admin-csv-list-header {
    background: #f8fafc;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    color: #374151;
    border-bottom: 1px solid #e5e7eb;
}

.admin-csv-search {
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-bottom: 1px solid #e5e7eb;
    font-size: 13px;
    box-sizing: border-box;
    outline: none;
}

.admin-csv-list-items {
    max-height: 200px;
    overflow-y: auto;
}

.admin-csv-list-item {
    padding: 8px 12px;
    font-size: 13px;
    cursor: pointer;
    border-bottom: 1px solid #f3f4f6;
    transition: background 0.15s;
}

.admin-csv-list-item:hover    { background: #f0f9ff; }
.admin-csv-list-item.selected { background: #dbeafe; font-weight: 500; }

.admin-csv-empty {
    padding: 12px;
    font-size: 13px;
    color: #9ca3af;
    text-align: center;
}

.admin-csv-pair-btn {
    padding: 8px 20px;
    background: #10b981;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
    margin-bottom: 16px;
}

.admin-csv-pair-btn:hover:not(:disabled) { background: #059669; }
.admin-csv-pair-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.admin-csv-pairs { border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 16px; }

.admin-csv-pairs-header {
    background: #f8fafc;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    color: #374151;
    border-bottom: 1px solid #e5e7eb;
}

.admin-csv-pair-row {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid #f3f4f6;
    font-size: 13px;
    gap: 8px;
}

.admin-csv-pair-email { flex: 1; color: #374151; }
.admin-csv-pair-arrow { color: #9ca3af; }
.admin-csv-pair-name  { flex: 1; color: #374151; }

.admin-csv-pair-delete {
    background: none;
    border: none;
    color: #9ca3af;
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 4px;
    transition: color 0.15s;
}

.admin-csv-pair-delete:hover { color: #ef4444; }

.admin-csv-import-btn {
    padding: 10px 24px;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
}

.admin-csv-import-btn:hover:not(:disabled) { background: #2563eb; }
.admin-csv-import-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.admin-csv-result-summary {
    font-size: 14px;
    font-weight: 500;
    color: #10b981;
    margin-bottom: 12px;
}

.admin-csv-result-row {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid #f3f4f6;
    font-size: 13px;
}

.admin-csv-result-email { color: #374151; }
.admin-csv-result-meta  { color: #6b7280; }

.admin-csv-reset-btn {
    margin-top: 16px;
    padding: 8px 16px;
    background: none;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    color: #374151;
    transition: background 0.15s;
}

.admin-csv-reset-btn:hover { background: #f9fafb; }

.admin-csv-existing-note {
    margin-top: 12px;
    font-size: 13px;
    color: #6b7280;
    display: flex;
    align-items: center;
    gap: 8px;
}

.admin-csv-link-btn {
    background: none;
    border: none;
    color: #3b82f6;
    cursor: pointer;
    font-size: 13px;
    padding: 0;
    text-decoration: underline;
}
```

**Step 3: Run the app and manually verify the panel appears in the admin view**

```bash
# In project root:
npm start
```

Navigate to admin view → confirm "Moodle Activity Log Import" panel is visible below the cluster diagnostics panel.

**Step 4: Run full test suite one final time**

```bash
cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage
```

Expected: all tests passing.

**Step 5: Commit**

```bash
git add src/pages/Home.tsx src/pages/Home.css
git commit -m "feat: add AdminCsvLogPanel to admin page with full CSS"
```

---

## Final Verification Checklist

After all tasks are complete:

- [ ] Migration ran: `csv_log_uploads` and `csv_participant_aliases` tables exist in DB
- [ ] `POST /api/lms/admin/csv/upload` accepts a CSV file and returns unique names
- [ ] Pairing UI shows app students as emails (List A) and CSV names (List B)
- [ ] Making a pair persists to DB; deleting a pair removes from DB
- [ ] Re-uploading same week's CSV reuses existing mappings automatically
- [ ] Import writes rows to `lms_sessions` with `is_simulated = false`
- [ ] EALT algorithm correctly groups events within 30-min windows
- [ ] `computeAllScores` and `computeJudgments` are triggered after import
- [ ] All 179+ backend tests still pass
- [ ] Admin UI shows import result summary per student
