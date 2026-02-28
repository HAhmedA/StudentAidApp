// Results endpoints
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { saveResponses, computeAnnotations } from '../services/annotators/srlAnnotationService.js'
import { computeAllScores } from '../services/scoring/scoreComputationService.js'
import { asyncRoute } from '../utils/errors.js'

const router = Router()

// Post new result
router.post('/post', asyncRoute(async (req, res) => {
    const { postId, surveyResult } = req.body || {}
    if (!postId || surveyResult == null) {
        return res.status(400).json({ error: 'postId and surveyResult are required' })
    }
    const id = uuidv4()
    const userId = req.session.user?.id || null
    const submittedAt = new Date()

    await pool.query(
        'INSERT INTO public.questionnaire_results (id, postid, answers, user_id, created_at) VALUES ($1, $2, $3::jsonb, $4, $5)',
        [id, postId, JSON.stringify(surveyResult), userId, submittedAt]
    )

    if (userId) {
        await saveResponses(pool, id, userId, surveyResult, submittedAt)

        const surveyQuery = await pool.query('SELECT json FROM public.surveys WHERE id = $1', [postId])
        if (surveyQuery.rows[0]) {
            await computeAnnotations(pool, userId, surveyQuery.rows[0].json)
        }

        // Trigger full score recomputation in background (do not await)
        computeAllScores(userId).catch(err =>
            logger.error('Score recomputation error after SRL submit:', err)
        )
    }

    logger.info(`Survey response submitted for ${postId}`)
    res.json({ id, postId })
}))

export default router
