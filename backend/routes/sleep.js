// Sleep data entry routes
import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAuth } from '../middleware/auth.js'
import { computeAllScores } from '../services/scoring/scoreComputationService.js'
import { asyncRoute, Errors } from '../utils/errors.js'
import { updateDataVersion } from '../services/chatbotPreferencesService.js'

const router = Router()

router.use(requireAuth)

// ── GET /api/sleep/today ────────────────────────────────────
// Returns today's sleep session for the logged-in user (if any).
// "Today's session" means session_date = yesterday (they're logging last night's sleep).
router.get('/today', asyncRoute(async (req, res) => {
        const userId = req.session.user?.id
        if (!userId) throw Errors.UNAUTHORIZED()

        const result = await pool.query(
            `SELECT session_date, bedtime, wake_time,
                    total_sleep_minutes, time_in_bed_minutes,
                    awakenings_count, awake_minutes
             FROM public.sleep_sessions
             WHERE user_id = $1
               AND session_date = CURRENT_DATE - INTERVAL '1 day'
               AND is_simulated = false
             LIMIT 1`,
            [userId]
        )

        return res.json({ entry: result.rows[0] || null })
}))

// ── POST /api/sleep ─────────────────────────────────────────
// Accepts: { intervals: [{ start: "HH:mm", end: "HH:mm" }, ...] }
// Computes sleep metrics and upserts into sleep_sessions for yesterday's date.
router.post('/', asyncRoute(async (req, res) => {
        const userId = req.session.user?.id
        if (!userId) throw Errors.UNAUTHORIZED()

        const { intervals, manualAwakenings } = req.body
        if (!Array.isArray(intervals) || intervals.length === 0) {
            throw Errors.VALIDATION('intervals required (array of {start, end})')
        }

        // Parse intervals: convert HH:mm strings to minute-of-day values
        // The slider uses a 12 PM → 12 PM axis, so times can cross midnight.
        // We treat the intervals relative to "yesterday evening → today morning".
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const sessionDate = yesterday.toISOString().split('T')[0] // YYYY-MM-DD

        // Convert HH:mm to track-minutes (track spans 12 PM noon → 12 PM next day).
        // Hours 12–23 are "before midnight" (track 0–719, yesterday evening).
        // Hours 0–11 are "after midnight" (track 720–1439, today morning).
        // This matches the frontend's minsToHHmm / hhmmToTrackMins formula exactly,
        // ensuring intervals are sorted chronologically even when they cross midnight.
        const toTrackMins = (hhmm) => {
            const [h, m] = hhmm.split(':').map(Number)
            return ((h - 12 + 24) % 24) * 60 + m
        }

        // Convert track-minutes to an absolute Date object
        const trackToDate = (trackMins) => {
            const d = new Date(yesterday)
            if (trackMins < 720) {
                // Before midnight → yesterday evening
                d.setHours(12 + Math.floor(trackMins / 60), trackMins % 60, 0, 0)
            } else {
                // After midnight → today morning
                const minsAfterMidnight = trackMins - 720
                d.setDate(d.getDate() + 1)
                d.setHours(Math.floor(minsAfterMidnight / 60), minsAfterMidnight % 60, 0, 0)
            }
            return d
        }

        const parsed = intervals.map(({ start, end }) => {
            const startTrack = toTrackMins(start)
            let endTrack = toTrackMins(end)
            // Guard: if end track <= start, interval wraps around noon (very unusual); extend by one full day
            if (endTrack <= startTrack) endTrack += 1440
            return { startTrack, endTrack, durationMins: endTrack - startTrack }
        })

        // Sort chronologically using track-minutes (not raw clock hours)
        parsed.sort((a, b) => a.startTrack - b.startTrack)

        const bedtimeDate = trackToDate(parsed[0].startTrack)
        const wakeDate = trackToDate(parsed[parsed.length - 1].endTrack)

        // Total sleep = sum of all interval durations
        const totalSleepMinutes = parsed.reduce((sum, p) => sum + p.durationMins, 0)

        // Time in bed = wake_time − bedtime (always non-negative now that sort is correct)
        const timeInBedMinutes = Math.max(0, Math.round((wakeDate.getTime() - bedtimeDate.getTime()) / 60000))

        // Awake minutes = time in bed - total sleep
        const awakeMinutes = Math.max(0, timeInBedMinutes - totalSleepMinutes)

        // Awakenings: manual field takes priority when provided; fall back to scroller gaps
        const gapAwakenings = Math.max(0, parsed.length - 1)
        let awakeningsCount
        if (manualAwakenings != null && Number.isInteger(manualAwakenings)
            && manualAwakenings >= 0 && manualAwakenings <= 20) {
            awakeningsCount = manualAwakenings
        } else {
            awakeningsCount = gapAwakenings
        }

        // Upsert into sleep_sessions (uses unique constraint on user_id + session_date)
        const upsertResult = await pool.query(
            `INSERT INTO public.sleep_sessions
                (user_id, session_date, bedtime, wake_time,
                 total_sleep_minutes, time_in_bed_minutes,
                 awakenings_count, awake_minutes, is_simulated)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
             ON CONFLICT (user_id, session_date)
             DO UPDATE SET
                bedtime = EXCLUDED.bedtime,
                wake_time = EXCLUDED.wake_time,
                total_sleep_minutes = EXCLUDED.total_sleep_minutes,
                time_in_bed_minutes = EXCLUDED.time_in_bed_minutes,
                awakenings_count = EXCLUDED.awakenings_count,
                awake_minutes = EXCLUDED.awake_minutes,
                is_simulated = false,
                created_at = now()
             RETURNING session_date, bedtime, wake_time,
                       total_sleep_minutes, time_in_bed_minutes,
                       awakenings_count, awake_minutes`,
            [userId, sessionDate, bedtimeDate.toISOString(), wakeDate.toISOString(),
                totalSleepMinutes, timeInBedMinutes, awakeningsCount, awakeMinutes]
        )

        // Trigger score recomputation in background (do not await)
        computeAllScores(userId).catch(err => logger.error('Score recomputation error after sleep submit:', err))
        updateDataVersion(userId).catch(err => logger.warn('data version update failed:', err.message))

        return res.json({ entry: upsertResult.rows[0] })
}))

export default router
