// Profile routes
import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncRoute, Errors } from '../utils/errors.js'

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

// Export all user data as CSV
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
                `SELECT cheerfulness, calmness, vitality, restedness, interest, submitted_at
                 FROM public.wellbeing_responses WHERE user_id = $1 ORDER BY submitted_at`,
                [userId]
            ),
            pool.query(
                `SELECT concept_key, score, submitted_at
                 FROM public.srl_responses WHERE user_id = $1 ORDER BY submitted_at`,
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
                        quiz_attempts, assignment_submissions, forum_posts
                 FROM public.lms_sessions WHERE user_id = $1 ORDER BY session_date`,
                [userId]
            ),
            pool.query(
                `SELECT concept_id, score, category, updated_at
                 FROM public.concept_scores WHERE user_id = $1 ORDER BY concept_id`,
                [userId]
            ),
            pool.query(
                `SELECT concept_id, score, category, scored_date
                 FROM public.concept_score_history WHERE user_id = $1 ORDER BY scored_date`,
                [userId]
            )
        ])

        const lines = []

        // Helper to add a section (uses blank-row separator for CSV compatibility)
        const addSection = (title, rows, columns) => {
            lines.push('')
            lines.push(`# ${title}`)
            if (rows.length === 0) {
                lines.push('# No data')
                return
            }
            lines.push(columns.join(','))
            for (const row of rows) {
                lines.push(columns.map(col => {
                    const val = row[col]
                    if (val === null || val === undefined) return ''
                    if (val instanceof Date) return val.toISOString()
                    const str = String(val)
                    return str.includes(',') || str.includes('"') || str.includes('\n')
                        ? `"${str.replace(/"/g, '""')}"` : str
                }).join(','))
            }
        }

        addSection('Questionnaire Submissions', questionnaires.rows,
            ['id', 'created_at'])
        addSection('Wellbeing Responses', wellbeing.rows,
            ['cheerfulness', 'calmness', 'vitality', 'restedness', 'interest', 'submitted_at'])
        addSection('SRL Responses', srl.rows,
            ['concept_key', 'score', 'submitted_at'])
        addSection('Sleep Sessions', sleep.rows,
            ['session_date', 'bedtime', 'wake_time', 'total_sleep_minutes', 'awakenings_count'])
        addSection('Screen Time Sessions', screenTime.rows,
            ['session_date', 'total_screen_minutes', 'longest_continuous_session', 'late_night_screen_minutes'])
        addSection('LMS Activity', lms.rows,
            ['session_date', 'total_active_minutes', 'total_events', 'reading_minutes', 'watching_minutes', 'quiz_attempts', 'assignment_submissions', 'forum_posts'])
        addSection('Concept Scores (Current)', scores.rows,
            ['concept_id', 'score', 'category', 'updated_at'])
        addSection('Concept Score History', scoreHistory.rows,
            ['concept_id', 'score', 'category', 'scored_date'])

        const csv = lines.join('\n')
        res.setHeader('Content-Type', 'text/csv')
        res.setHeader('Content-Disposition', 'attachment; filename="my-data-export.csv"')
        res.send(csv)

        logger.info(`Data exported for user: ${userId}`)
}))

export default router
