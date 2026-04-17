// Profile routes
import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncRoute, Errors } from '../utils/errors.js'
import { buildProjectDataCsv } from '../services/projectDataExportService.js'

const router = Router()

// All profile routes require auth
router.use(requireAuth)

// Get profile (used for onboarding_completed check)
router.get('/', asyncRoute(async (req, res) => {
        const userId = req.session.user?.id
        if (!userId) throw Errors.UNAUTHORIZED()

        const { rows } = await pool.query(
            'SELECT user_id, onboarding_completed, updated_at FROM public.student_profiles WHERE user_id = $1',
            [userId]
        )

        if (rows.length === 0) throw Errors.NOT_FOUND('Profile')

        res.json(rows[0])
}))

// Mark onboarding as complete
router.post('/onboarding-complete', asyncRoute(async (req, res) => {
        const userId = req.session.user?.id
        if (!userId) throw Errors.UNAUTHORIZED()

        await pool.query(
            `INSERT INTO public.student_profiles (user_id, onboarding_completed, updated_at)
             VALUES ($1, true, NOW())
             ON CONFLICT (user_id)
             DO UPDATE SET onboarding_completed = true, updated_at = NOW()`,
            [userId]
        )

        logger.info(`Onboarding completed for user: ${userId}`)
        res.json({ success: true })
}))

// CSV cell escaper — shared by both export endpoints
const escapeCell = (val) => {
    if (val === null || val === undefined) return ''
    if (val instanceof Date) return val.toISOString()
    const str = String(val)
    return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"` : str
}

// Export all user data as multi-section CSV
router.get('/export', asyncRoute(async (req, res) => {
        const userId = req.session.user?.id
        if (!userId) throw Errors.UNAUTHORIZED()

        const [questionnaires, wellbeing, srl, sleep, screenTime, lms, scores, scoreHistory] = await Promise.all([
            pool.query(
                `SELECT id, created_at FROM public.questionnaire_results
                 WHERE user_id = $1 AND is_simulated = false ORDER BY created_at`,
                [userId]
            ),
            pool.query(
                `SELECT submitted_at, cheerfulness, calmness, vitality, restedness, interest
                 FROM public.wellbeing_responses WHERE user_id = $1 ORDER BY submitted_at`,
                [userId]
            ),
            pool.query(
                `SELECT submitted_at,
                        MAX(CASE WHEN concept_key = 'efficiency' THEN score END) AS efficiency,
                        MAX(CASE WHEN concept_key = 'importance' THEN score END) AS importance,
                        MAX(CASE WHEN concept_key = 'tracking' THEN score END) AS tracking,
                        MAX(CASE WHEN concept_key = 'effort' THEN score END) AS effort,
                        MAX(CASE WHEN concept_key = 'help_seeking' THEN score END) AS help_seeking,
                        MAX(CASE WHEN concept_key = 'community' THEN score END) AS community,
                        MAX(CASE WHEN concept_key = 'timeliness' THEN score END) AS timeliness,
                        MAX(CASE WHEN concept_key = 'motivation' THEN score END) AS motivation,
                        MAX(CASE WHEN concept_key = 'anxiety' THEN score END) AS anxiety,
                        MAX(CASE WHEN concept_key = 'reflection' THEN score END) AS reflection
                 FROM public.srl_responses WHERE user_id = $1
                 GROUP BY submitted_at ORDER BY submitted_at`,
                [userId]
            ),
            pool.query(
                `SELECT session_date, bedtime, wake_time, total_sleep_minutes, awakenings_count
                 FROM public.sleep_sessions WHERE user_id = $1 ORDER BY session_date`,
                [userId]
            ),
            pool.query(
                `SELECT session_date, total_screen_minutes, longest_continuous_session, late_night_screen_minutes
                 FROM public.screen_time_sessions WHERE user_id = $1 ORDER BY session_date`,
                [userId]
            ),
            pool.query(
                `SELECT session_date, total_active_minutes, total_events, reading_minutes, watching_minutes,
                        exercise_practice_events, assignment_work_events, forum_views, forum_posts
                 FROM public.lms_sessions WHERE user_id = $1 ORDER BY session_date`,
                [userId]
            ),
            pool.query(
                `SELECT MAX(computed_at) AS computed_at,
                        MAX(CASE WHEN concept_id = 'sleep' THEN score END) AS sleep_score,
                        MAX(CASE WHEN concept_id = 'sleep' THEN trend END) AS sleep_trend,
                        MAX(CASE WHEN concept_id = 'srl' THEN score END) AS srl_score,
                        MAX(CASE WHEN concept_id = 'srl' THEN trend END) AS srl_trend,
                        MAX(CASE WHEN concept_id = 'lms' THEN score END) AS lms_score,
                        MAX(CASE WHEN concept_id = 'lms' THEN trend END) AS lms_trend,
                        MAX(CASE WHEN concept_id = 'screen_time' THEN score END) AS screen_time_score,
                        MAX(CASE WHEN concept_id = 'screen_time' THEN trend END) AS screen_time_trend
                 FROM public.concept_scores WHERE user_id = $1`,
                [userId]
            ),
            pool.query(
                `SELECT score_date,
                        MAX(CASE WHEN concept_id = 'sleep' THEN score END) AS sleep_score,
                        MAX(CASE WHEN concept_id = 'srl' THEN score END) AS srl_score,
                        MAX(CASE WHEN concept_id = 'lms' THEN score END) AS lms_score,
                        MAX(CASE WHEN concept_id = 'screen_time' THEN score END) AS screen_time_score
                 FROM public.concept_score_history WHERE user_id = $1
                 GROUP BY score_date ORDER BY score_date`,
                [userId]
            )
        ])

        const lines = []

        const addSection = (title, rows, columns) => {
            lines.push('')
            lines.push(`# ${title}`)
            if (rows.length === 0) {
                lines.push('# No data')
                return
            }
            lines.push(columns.join(','))
            for (const row of rows) {
                lines.push(columns.map(col => escapeCell(row[col])).join(','))
            }
        }

        addSection('Questionnaire Submissions', questionnaires.rows,
            ['created_at', 'id'])
        addSection('Wellbeing Responses', wellbeing.rows,
            ['submitted_at', 'cheerfulness', 'calmness', 'vitality', 'restedness', 'interest'])
        addSection('SRL Responses', srl.rows,
            ['submitted_at', 'efficiency', 'importance', 'tracking', 'effort', 'help_seeking',
             'community', 'timeliness', 'motivation', 'anxiety', 'reflection'])
        addSection('Sleep Sessions', sleep.rows,
            ['session_date', 'bedtime', 'wake_time', 'total_sleep_minutes', 'awakenings_count'])
        addSection('Screen Time Sessions', screenTime.rows,
            ['session_date', 'total_screen_minutes', 'longest_continuous_session', 'late_night_screen_minutes'])
        addSection('LMS Activity', lms.rows,
            ['session_date', 'total_active_minutes', 'total_events', 'reading_minutes', 'watching_minutes',
             'exercise_practice_events', 'assignment_work_events', 'forum_views', 'forum_posts'])
        addSection('Concept Scores (Current)', scores.rows,
            ['computed_at', 'sleep_score', 'sleep_trend', 'srl_score', 'srl_trend',
             'lms_score', 'lms_trend', 'screen_time_score', 'screen_time_trend'])
        addSection('Concept Score History', scoreHistory.rows,
            ['score_date', 'sleep_score', 'srl_score', 'lms_score', 'screen_time_score'])

        const csv = lines.join('\n')
        res.setHeader('Content-Type', 'text/csv')
        res.setHeader('Content-Disposition', 'attachment; filename="my-data-export.csv"')
        res.send(csv)

        logger.info(`Data exported for user: ${userId}`)
}))

// Export all user data as a single flat CSV grouped by date
router.get('/export-unified', asyncRoute(async (req, res) => {
        const userId = req.session.user?.id
        if (!userId) throw Errors.UNAUTHORIZED()

        const [wellbeing, srl, sleep, screenTime, lms] = await Promise.all([
            // Latest wellbeing per day
            pool.query(
                `SELECT DISTINCT ON (submitted_at::date)
                        submitted_at::date AS date,
                        cheerfulness, calmness, vitality, restedness, interest
                 FROM public.wellbeing_responses WHERE user_id = $1
                 ORDER BY submitted_at::date, submitted_at DESC`,
                [userId]
            ),
            // Latest SRL pivot per day
            pool.query(
                `SELECT DISTINCT ON ((submitted_at::date))
                        submitted_at::date AS date,
                        efficiency, importance, tracking, effort, help_seeking,
                        community, timeliness, motivation, anxiety, reflection
                 FROM (
                     SELECT submitted_at,
                            MAX(CASE WHEN concept_key = 'efficiency' THEN score END) AS efficiency,
                            MAX(CASE WHEN concept_key = 'importance' THEN score END) AS importance,
                            MAX(CASE WHEN concept_key = 'tracking' THEN score END) AS tracking,
                            MAX(CASE WHEN concept_key = 'effort' THEN score END) AS effort,
                            MAX(CASE WHEN concept_key = 'help_seeking' THEN score END) AS help_seeking,
                            MAX(CASE WHEN concept_key = 'community' THEN score END) AS community,
                            MAX(CASE WHEN concept_key = 'timeliness' THEN score END) AS timeliness,
                            MAX(CASE WHEN concept_key = 'motivation' THEN score END) AS motivation,
                            MAX(CASE WHEN concept_key = 'anxiety' THEN score END) AS anxiety,
                            MAX(CASE WHEN concept_key = 'reflection' THEN score END) AS reflection
                     FROM public.srl_responses WHERE user_id = $1
                     GROUP BY submitted_at
                 ) pivoted
                 ORDER BY (submitted_at::date), submitted_at DESC`,
                [userId]
            ),
            pool.query(
                `SELECT session_date AS date, total_sleep_minutes, bedtime, wake_time, awakenings_count
                 FROM public.sleep_sessions WHERE user_id = $1 ORDER BY session_date`,
                [userId]
            ),
            pool.query(
                `SELECT session_date AS date, total_screen_minutes, longest_continuous_session, late_night_screen_minutes
                 FROM public.screen_time_sessions WHERE user_id = $1 ORDER BY session_date`,
                [userId]
            ),
            pool.query(
                `SELECT session_date AS date, total_active_minutes, total_events,
                        exercise_practice_events, assignment_work_events, forum_views, forum_posts
                 FROM public.lms_sessions WHERE user_id = $1 ORDER BY session_date`,
                [userId]
            ),
        ])

        // Merge all sources into a map keyed by date string
        const dateMap = new Map()
        const ensureDate = (d) => {
            const key = d instanceof Date ? d.toISOString().slice(0, 10) : String(d)
            if (!dateMap.has(key)) dateMap.set(key, { date: key })
            return dateMap.get(key)
        }

        for (const row of wellbeing.rows) {
            const entry = ensureDate(row.date)
            Object.assign(entry, {
                cheerfulness: row.cheerfulness, calmness: row.calmness,
                vitality: row.vitality, restedness: row.restedness, interest: row.interest,
            })
        }
        for (const row of srl.rows) {
            const entry = ensureDate(row.date)
            Object.assign(entry, {
                efficiency: row.efficiency, importance: row.importance, tracking: row.tracking,
                effort: row.effort, help_seeking: row.help_seeking, community: row.community,
                timeliness: row.timeliness, motivation: row.motivation, anxiety: row.anxiety,
                reflection: row.reflection,
            })
        }
        for (const row of sleep.rows) {
            const entry = ensureDate(row.date)
            Object.assign(entry, {
                total_sleep_minutes: row.total_sleep_minutes, bedtime: row.bedtime,
                wake_time: row.wake_time, awakenings_count: row.awakenings_count,
            })
        }
        for (const row of screenTime.rows) {
            const entry = ensureDate(row.date)
            Object.assign(entry, {
                total_screen_minutes: row.total_screen_minutes,
                longest_continuous_session: row.longest_continuous_session,
                late_night_screen_minutes: row.late_night_screen_minutes,
            })
        }
        for (const row of lms.rows) {
            const entry = ensureDate(row.date)
            Object.assign(entry, {
                total_active_minutes: row.total_active_minutes, total_events: row.total_events,
                exercise_practice_events: row.exercise_practice_events,
                assignment_work_events: row.assignment_work_events,
                forum_views: row.forum_views, forum_posts: row.forum_posts,
            })
        }

        const columns = [
            'date',
            'cheerfulness', 'calmness', 'vitality', 'restedness', 'interest',
            'efficiency', 'importance', 'tracking', 'effort', 'help_seeking',
            'community', 'timeliness', 'motivation', 'anxiety', 'reflection',
            'total_sleep_minutes', 'bedtime', 'wake_time', 'awakenings_count',
            'total_screen_minutes', 'longest_continuous_session', 'late_night_screen_minutes',
            'total_active_minutes', 'total_events',
            'exercise_practice_events', 'assignment_work_events', 'forum_views', 'forum_posts',
        ]

        const sortedDates = [...dateMap.keys()].sort()
        const lines = [columns.join(',')]
        for (const d of sortedDates) {
            const entry = dateMap.get(d)
            lines.push(columns.map(col => escapeCell(entry[col])).join(','))
        }

        res.setHeader('Content-Type', 'text/csv')
        res.setHeader('Content-Disposition', 'attachment; filename="my-data-unified.csv"')
        res.send(lines.join('\n'))

        logger.info(`Unified data exported for user: ${userId}`)
}))

// Download a compiled, anonymized project-data CSV: random sample of real
// SRL + wellbeing responses from a subset of students, padded with synthetic
// rows to >=70, rescaled to an integer 1..5 unified scale, fresh each click.
router.get('/export-project', asyncRoute(async (req, res) => {
        const userId = req.session.user?.id
        if (!userId) throw Errors.UNAUTHORIZED()

        const csv = await buildProjectDataCsv(pool)

        res.setHeader('Content-Type', 'text/csv')
        res.setHeader('Content-Disposition', 'attachment; filename="project-data.csv"')
        res.send(csv)

        const rowCount = csv.split('\n').length - 1   // minus header
        logger.info(`Project data exported by user: ${userId} (${rowCount} rows)`)
}))

// ── Support requests (student → admin) ──────────────────────────

const VALID_CATEGORIES = [
    'account_issue', 'data_concern', 'chatbot_problem',
    'technical_bug', 'feature_request', 'other'
]

// Submit a support request
router.post('/support-request', asyncRoute(async (req, res) => {
    const userId = req.session.user?.id
    if (!userId) throw Errors.UNAUTHORIZED()

    const { category, message } = req.body

    if (!category || !VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` })
    }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: 'message is required' })
    }
    if (message.length > 2000) {
        return res.status(400).json({ error: 'message must be 2000 characters or less' })
    }

    // Rate limit: max 5 open requests per user
    const { rows: openCount } = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM support_requests
         WHERE user_id = $1 AND status = 'open'`, [userId]
    )
    if (openCount[0].cnt >= 5) {
        return res.status(429).json({
            error: 'You have too many open requests. Please wait for existing ones to be resolved.'
        })
    }

    const { rows } = await pool.query(
        `INSERT INTO support_requests (user_id, category, message)
         VALUES ($1, $2, $3)
         RETURNING id, category, message, status, created_at`,
        [userId, category, message.trim()]
    )

    logger.info(`Support request created by user ${userId}: ${rows[0].id}`)
    res.status(201).json({ request: rows[0] })
}))

// Get own support requests
router.get('/support-requests', asyncRoute(async (req, res) => {
    const userId = req.session.user?.id
    if (!userId) throw Errors.UNAUTHORIZED()

    const { rows } = await pool.query(
        `SELECT id, category, message, status, admin_response, created_at, resolved_at
         FROM support_requests WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 20`,
        [userId]
    )

    res.json({ requests: rows })
}))

export default router
