// Survey routes
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { asyncRoute } from '../utils/errors.js'

const router = Router()

// Fixed survey configuration
const FIXED_SURVEY_NAME = 'Self-Regulated Learning Questionnaire'

// Helper to normalize survey rows
const mapSurveyRow = (row) => ({ id: row.id, name: row.name, json: row.json })

// Minimal survey metadata (questions are defined in frontend constants)
const getDefaultSurveyTemplate = () => ({
    title: FIXED_SURVEY_NAME,
    version: 1,
})

/**
 * Ensure the fixed Self-Regulated Learning Questionnaire exists.
 * Called on server startup.
 */
export const ensureFixedSurvey = async () => {
    try {
        const { rows } = await pool.query('SELECT id FROM public.surveys LIMIT 1')

        if (rows.length === 0) {
            const id = uuidv4()
            const json = getDefaultSurveyTemplate()
            await pool.query(
                'INSERT INTO public.surveys (id, name, json) VALUES ($1, $2, $3::jsonb)',
                [id, FIXED_SURVEY_NAME, JSON.stringify(json)]
            )
            logger.info(`Fixed survey "${FIXED_SURVEY_NAME}" created with id: ${id}`)
        } else {
            const existingSurvey = await pool.query('SELECT id FROM public.surveys LIMIT 1')
            if (existingSurvey.rows[0]) {
                const newJson = getDefaultSurveyTemplate()
                await pool.query(
                    'UPDATE public.surveys SET name = $2, json = $3::jsonb WHERE id = $1',
                    [existingSurvey.rows[0].id, FIXED_SURVEY_NAME, JSON.stringify(newJson)]
                )
                logger.info(`Updated survey JSON to latest template`)
            }
        }
    } catch (e) {
        logger.error(`Error ensuring fixed survey: ${e.message}`)
        throw e
    }
}

// Get all surveys
router.get('/getActive', asyncRoute(async (req, res) => {
        const { rows } = await pool.query('SELECT id, name, json FROM public.surveys ORDER BY name NULLS LAST')
        res.json(rows.map(mapSurveyRow))
}))

export default router
