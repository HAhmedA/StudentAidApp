// Admin routes
import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAdmin } from '../middleware/auth.js'
import { DEFAULT_ALIGNMENT_PROMPT } from '../services/alignmentService.js'
import { getAnnotations } from '../services/annotators/srlAnnotationService.js'
import { asyncRoute, Errors } from '../utils/errors.js'
import { CONCEPT_NAMES } from '../config/concepts.js'

const router = Router()

// All admin routes require admin privileges
router.use(requireAdmin)

// Valid prompt types
const VALID_PROMPT_TYPES = ['system', 'alignment']

// Get prompt by type (default: system)
router.get('/prompt', asyncRoute(async (req, res) => {
        const promptType = req.query.type || 'system'

        if (!VALID_PROMPT_TYPES.includes(promptType)) {
            throw Errors.VALIDATION(`invalid_prompt_type — valid: ${VALID_PROMPT_TYPES.join(', ')}`)
        }

        const { rows } = await pool.query(
            `SELECT prompt, prompt_type, updated_at
             FROM public.system_prompts
             WHERE prompt_type = $1
             ORDER BY updated_at DESC LIMIT 1`,
            [promptType]
        )

        if (rows.length === 0) {
            const defaultPrompt = promptType === 'system' ? 'Be Ethical' : DEFAULT_ALIGNMENT_PROMPT
            return res.json({ prompt: defaultPrompt, prompt_type: promptType, updated_at: null })
        }

        res.json(rows[0])
}))

// Get all prompts (both types)
router.get('/prompts', asyncRoute(async (req, res) => {
        const prompts = {}

        for (const type of VALID_PROMPT_TYPES) {
            const { rows } = await pool.query(
                `SELECT prompt, prompt_type, updated_at
                 FROM public.system_prompts
                 WHERE prompt_type = $1
                 ORDER BY updated_at DESC LIMIT 1`,
                [type]
            )

            prompts[type] = rows.length > 0 ? rows[0] : {
                prompt: type === 'system' ? 'Be Ethical' : DEFAULT_ALIGNMENT_PROMPT,
                prompt_type: type,
                updated_at: null
            }
        }

        res.json(prompts)
}))

// Update prompt by type
router.put('/prompt', asyncRoute(async (req, res) => {
        const { prompt, type } = req.body
        const promptType = type || 'system'
        const userId = req.session.user?.id

        if (!VALID_PROMPT_TYPES.includes(promptType)) {
            throw Errors.VALIDATION(`invalid_prompt_type — valid: ${VALID_PROMPT_TYPES.join(', ')}`)
        }

        if (!prompt || typeof prompt !== 'string') {
            throw Errors.VALIDATION('prompt is required')
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
}))

// ── Student viewer endpoints ──────────────────────────────────────

// List all student users
router.get('/students', asyncRoute(async (req, res) => {
        const { rows } = await pool.query(
            `SELECT id, name, email FROM public.users WHERE role = 'student' ORDER BY created_at DESC`
        )
        res.json({ students: rows })
}))

// Get concept scores for a specific student (mirrors /api/scores logic)
router.get('/students/:studentId/scores', asyncRoute(async (req, res) => {
        const { studentId } = req.params

        const { rows } = await pool.query(
            `SELECT concept_id, score, trend, aspect_breakdown, computed_at
             FROM public.concept_scores
             WHERE user_id = $1
             ORDER BY concept_id`,
            [studentId]
        )

        // Yesterday scores
        const { rows: yesterdayRows } = await pool.query(
            `SELECT concept_id, score
             FROM public.concept_score_history
             WHERE user_id = $1 AND score_date = CURRENT_DATE - 1`,
            [studentId]
        )
        const yesterdayScores = {}
        for (const r of yesterdayRows) {
            yesterdayScores[r.concept_id] = Math.round(parseFloat(r.score) * 100) / 100
        }

        // Cluster info
        const { rows: clusterRows } = await pool.query(
            `SELECT uca.concept_id, uca.cluster_label, uca.percentile_position,
                    pc.p5, pc.p50, pc.p95
             FROM public.user_cluster_assignments uca
             JOIN public.peer_clusters pc
               ON pc.concept_id = uca.concept_id AND pc.cluster_index = uca.cluster_index
             WHERE uca.user_id = $1`,
            [studentId]
        )
        const clusterInfo = {}
        for (const r of clusterRows) {
            clusterInfo[r.concept_id] = {
                clusterLabel: r.cluster_label,
                percentilePosition: parseFloat(r.percentile_position) || 50,
                dialMin: Math.round(parseFloat(r.p5) * 100) / 100,
                dialCenter: Math.round(parseFloat(r.p50) * 100) / 100,
                dialMax: Math.round(parseFloat(r.p95) * 100) / 100
            }
        }

        const scores = rows.map(row => ({
            conceptId: row.concept_id,
            conceptName: CONCEPT_NAMES[row.concept_id] || row.concept_id,
            score: parseFloat(row.score),
            trend: row.trend,
            breakdown: row.aspect_breakdown,
            yesterdayScore: yesterdayScores[row.concept_id] || null,
            clusterLabel: clusterInfo[row.concept_id]?.clusterLabel || null,
            dialMin: clusterInfo[row.concept_id]?.dialMin || 0,
            dialCenter: clusterInfo[row.concept_id]?.dialCenter || 50,
            dialMax: clusterInfo[row.concept_id]?.dialMax || 100,
            computedAt: row.computed_at
        }))

        res.json({ scores })
}))

// Get annotations for a specific student
router.get('/students/:studentId/annotations', asyncRoute(async (req, res) => {
        const { studentId } = req.params
        const { timeWindow } = req.query
        const annotations = await getAnnotations(pool, studentId, timeWindow, false)
        res.json({ annotations })
}))

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
