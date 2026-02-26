// Profile routes
import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncRoute, Errors } from '../utils/errors.js'

const router = Router()

// All profile routes require auth
router.use(requireAuth)

// Get profile
router.get('/', asyncRoute(async (req, res) => {
        const userId = req.session.user?.id
        if (!userId) throw Errors.UNAUTHORIZED()

        const { rows } = await pool.query(
            'SELECT user_id, edu_level, field_of_study, major, learning_formats, disabilities, onboarding_completed, updated_at FROM public.student_profiles WHERE user_id = $1',
            [userId]
        )

        if (rows.length === 0) throw Errors.NOT_FOUND('Profile')

        res.json(rows[0])
}))

// Update profile
router.put('/', asyncRoute(async (req, res) => {
        const userId = req.session.user?.id
        if (!userId) throw Errors.UNAUTHORIZED()

        const { edu_level, field_of_study, major, learning_formats, disabilities } = req.body

        // Upsert: insert or update if exists
        const { rows } = await pool.query(
            `INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         edu_level = EXCLUDED.edu_level,
         field_of_study = EXCLUDED.field_of_study,
         major = EXCLUDED.major,
         learning_formats = EXCLUDED.learning_formats,
         disabilities = EXCLUDED.disabilities,
         updated_at = NOW()
       RETURNING user_id, edu_level, field_of_study, major, learning_formats, disabilities, updated_at`,
            [userId, edu_level || '', field_of_study || '', major || '', JSON.stringify(learning_formats || []), JSON.stringify(disabilities || [])]
        )

        logger.info(`Profile updated for user: ${userId}`)
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

export default router
