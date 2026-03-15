// Survey routes
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { asyncRoute, Errors } from '../utils/errors.js'

const router = Router()

// Fixed survey configuration
const FIXED_SURVEY_NAME = 'Self-Regulated Learning Questionnaire'

// Helper to normalize survey rows
const mapSurveyRow = (row) => ({ id: row.id, name: row.name, json: row.json })

// Default survey template with title
const getDefaultSurveyTemplate = () => ({
    title: FIXED_SURVEY_NAME,
    pages: [
        {
            name: 'wellbeing',
            title: 'How are you feeling today?',
            description: 'Rate how you have felt over the past day.',
            elements: [
                { type: 'rating', name: 'cheerfulness', title: 'I have felt cheerful and in good spirits.', mininumRateDescription: 'Not at all', maximumRateDescription: 'All the time' },
                { type: 'rating', name: 'calmness', title: 'I have felt calm and relaxed.', mininumRateDescription: 'Not at all', maximumRateDescription: 'All the time' },
                { type: 'rating', name: 'vitality', title: 'I have felt active and vigorous.', mininumRateDescription: 'Not at all', maximumRateDescription: 'All the time' },
                { type: 'rating', name: 'restedness', title: 'I woke up feeling fresh and rested.', mininumRateDescription: 'Not at all', maximumRateDescription: 'All the time' },
                { type: 'rating', name: 'interest', title: 'My daily life has been filled with things that interest me.', mininumRateDescription: 'Not at all', maximumRateDescription: 'All the time' }
            ]
        },
        {
            name: 'learning',
            title: 'Your Learning Today',
            description: 'Reflect on your learning strategies and experience.',
            elements: [
                { type: 'rating', name: 'efficiency', title: 'I believe I can accomplish my learning duties and learning tasks efficiently.', mininumRateDescription: 'Strongly disagree', maximumRateDescription: 'Strongly agree' },
                { type: 'rating', name: 'importance', title: 'I believe that my learning tasks are very important to me.', mininumRateDescription: 'Not important', maximumRateDescription: 'Very important' },
                { type: 'rating', name: 'tracking', title: 'I keep track of what I need to do and understand what I must do to accomplish my learning tasks.', mininumRateDescription: 'Never', maximumRateDescription: 'Always' },
                { type: 'rating', name: 'effort', title: 'I put enough effort into my learning tasks and stay focused while working on them.', mininumRateDescription: 'Not enough effort', maximumRateDescription: 'A lot of effort' },
                { type: 'rating', name: 'help_seeking', title: 'I seek help from teachers, friends, or the internet when I need explanation or help with difficult tasks.', mininumRateDescription: 'Never seek help', maximumRateDescription: 'Always seek help' },
                { type: 'rating', name: 'community', title: 'I am having nice interactions and feeling at home within the college community.', mininumRateDescription: 'Not at all', maximumRateDescription: 'Very much' },
                { type: 'rating', name: 'timeliness', title: 'I am doing my studies on time and keeping up with tasks/deadlines.', mininumRateDescription: 'Always late', maximumRateDescription: 'Always on time' },
                { type: 'rating', name: 'motivation', title: 'I feel motivated to learn and enjoy working on my learning tasks.', mininumRateDescription: 'Not motivated', maximumRateDescription: 'Highly motivated' },
                { type: 'rating', name: 'anxiety', title: 'I feel anxious or stressed working on learning tasks, assignments, or in class.', mininumRateDescription: 'Never anxious', maximumRateDescription: 'Very anxious' },
                { type: 'rating', name: 'reflection', title: 'I reflect on my performance and learn from feedback or mistakes to improve my learning.', mininumRateDescription: 'Never reflect', maximumRateDescription: 'Always reflect' }
            ]
        }
    ]
})

/**
 * Ensure the fixed Self-Regulated Learning Questionnaire exists.
 * Called on server startup.
 */
export const ensureFixedSurvey = async () => {
    try {
        // Check if any survey exists
        const { rows } = await pool.query('SELECT id FROM public.surveys LIMIT 1')

        if (rows.length === 0) {
            // No surveys exist, create the fixed one
            const id = uuidv4()
            const json = getDefaultSurveyTemplate()
            await pool.query(
                'INSERT INTO public.surveys (id, name, json) VALUES ($1, $2, $3::jsonb)',
                [id, FIXED_SURVEY_NAME, JSON.stringify(json)]
            )
            logger.info(`Fixed survey "${FIXED_SURVEY_NAME}" created with id: ${id}`)
        } else {
            // Always overwrite survey JSON with current template
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

// Get single survey
router.get('/getSurvey', asyncRoute(async (req, res) => {
        const id = req.query.surveyId
        const { rows } = await pool.query('SELECT id, name, json FROM public.surveys WHERE id = $1', [id])
        res.json(rows[0] ? mapSurveyRow(rows[0]) : null)
}))

// Update survey JSON (admin can still edit the survey content)
router.post('/changeJson', asyncRoute(async (req, res) => {
        const { id, json } = req.body || {}
        // Ensure the title is always preserved
        if (json && !json.title) {
            json.title = FIXED_SURVEY_NAME
        }
        const { rows } = await pool.query(
            'UPDATE public.surveys SET json = $2::jsonb WHERE id = $1 RETURNING id, name, json',
            [id, JSON.stringify(json)]
        )
        if (!rows[0]) throw Errors.NOT_FOUND('Survey')
        logger.info(`Survey updated: ${id}`)
        res.json(mapSurveyRow(rows[0]))
}))

export default router
