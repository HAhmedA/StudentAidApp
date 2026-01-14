// Admin routes
import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAdmin } from '../middleware/auth.js'
import { DEFAULT_ALIGNMENT_PROMPT } from '../services/alignmentService.js'

const router = Router()

// All admin routes require admin privileges
router.use(requireAdmin)

// Valid prompt types
const VALID_PROMPT_TYPES = ['system', 'alignment']

// Get prompt by type (default: system)
router.get('/prompt', async (req, res) => {
    try {
        const promptType = req.query.type || 'system'

        if (!VALID_PROMPT_TYPES.includes(promptType)) {
            return res.status(400).json({ error: 'invalid_prompt_type', valid: VALID_PROMPT_TYPES })
        }

        const { rows } = await pool.query(
            `SELECT prompt, prompt_type, updated_at 
             FROM public.system_prompts 
             WHERE prompt_type = $1 
             ORDER BY updated_at DESC LIMIT 1`,
            [promptType]
        )

        if (rows.length === 0) {
            // Return default if no prompt exists
            const defaultPrompt = promptType === 'system'
                ? 'Be Ethical'
                : DEFAULT_ALIGNMENT_PROMPT
            return res.json({ prompt: defaultPrompt, prompt_type: promptType, updated_at: null })
        }

        res.json(rows[0])
    } catch (e) {
        logger.error('Get prompt error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

// Get all prompts (both types)
router.get('/prompts', async (req, res) => {
    try {
        const prompts = {}

        for (const type of VALID_PROMPT_TYPES) {
            const { rows } = await pool.query(
                `SELECT prompt, prompt_type, updated_at 
                 FROM public.system_prompts 
                 WHERE prompt_type = $1 
                 ORDER BY updated_at DESC LIMIT 1`,
                [type]
            )

            if (rows.length > 0) {
                prompts[type] = rows[0]
            } else {
                prompts[type] = {
                    prompt: type === 'system' ? 'Be Ethical' : DEFAULT_ALIGNMENT_PROMPT,
                    prompt_type: type,
                    updated_at: null
                }
            }
        }

        res.json(prompts)
    } catch (e) {
        logger.error('Get all prompts error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

// Update prompt by type
router.put('/prompt', async (req, res) => {
    try {
        const { prompt, type } = req.body
        const promptType = type || 'system'
        const userId = req.session.user?.id

        if (!VALID_PROMPT_TYPES.includes(promptType)) {
            return res.status(400).json({ error: 'invalid_prompt_type', valid: VALID_PROMPT_TYPES })
        }

        if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({ error: 'prompt is required' })
        }

        // Insert new prompt (keep history)
        const { rows } = await pool.query(
            `INSERT INTO public.system_prompts (prompt, prompt_type, created_by, updated_at) 
             VALUES ($1, $2, $3, NOW()) 
             RETURNING prompt, prompt_type, updated_at`,
            [prompt, promptType, userId]
        )

        logger.info(`${promptType} prompt updated by admin: ${userId}`)
        res.json(rows[0])
    } catch (e) {
        logger.error('Update prompt error:', e)
        res.status(500).json({ error: 'db_error', details: String(e) })
    }
})

// Legacy routes for backwards compatibility
router.get('/system-prompt', async (req, res) => {
    req.query.type = 'system'
    return router.handle(req, res)
})

router.put('/system-prompt', async (req, res) => {
    req.body.type = 'system'
    return router.handle(req, res)
})

export default router

