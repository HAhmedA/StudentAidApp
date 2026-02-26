// Scores routes - exposes concept scores for dashboard display

/**
 * @typedef {Object} ConceptScoreResponse
 * @property {string} conceptId
 * @property {string} conceptName
 * @property {number|null} score
 * @property {'improving'|'declining'|'stable'|null} trend
 * @property {number|null} avg7d
 * @property {number|null} yesterdayScore
 * @property {string|null} clusterLabel
 * @property {number} dialMin
 * @property {number} dialCenter
 * @property {number} dialMax
 * @property {string|null} computedAt
 * @property {boolean} coldStart
 * @property {Object|null} breakdown
 */
import { Router } from 'express'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAuth } from '../middleware/auth.js'
import { CONCEPT_IDS, CONCEPT_NAMES } from '../config/concepts.js'
import { asyncRoute, Errors } from '../utils/errors.js'
import { getConceptPoolSizes, getUserConceptDataSet } from '../services/scoring/scoreQueryService.js'

const router = Router()

// All score routes require auth
router.use(requireAuth)

/**
 * GET /api/scores
 * Get all concept scores for the current user
 * Returns array of { conceptId, score, trend, computedAt }
 */
router.get('/', asyncRoute(async (req, res) => {
        const userId = req.session.user?.id
        if (!userId) throw Errors.UNAUTHORIZED()

        const { rows } = await pool.query(
            `SELECT concept_id, score, trend, avg_7d, aspect_breakdown, previous_aspect_breakdown, computed_at
             FROM public.concept_scores
             WHERE user_id = $1
             ORDER BY concept_id`,
            [userId]
        )

        // Get yesterday's score + breakdown for each concept (for needle and self-comparison)
        const { rows: yesterdayRows } = await pool.query(
            `SELECT concept_id, score, aspect_breakdown
             FROM public.concept_score_history
             WHERE user_id = $1 AND score_date = CURRENT_DATE - 1`,
            [userId]
        )
        const yesterdayScores = {}
        const yesterdayBreakdowns = {}
        for (const r of yesterdayRows) {
            yesterdayScores[r.concept_id] = Math.round(parseFloat(r.score) * 100) / 100
            yesterdayBreakdowns[r.concept_id] = r.aspect_breakdown || null
        }

        // Get cluster info for each concept
        const { rows: clusterRows } = await pool.query(
            `SELECT uca.concept_id, uca.cluster_label, uca.percentile_position,
                    pc.p5, pc.p50, pc.p95
             FROM public.user_cluster_assignments uca
             JOIN public.peer_clusters pc
               ON pc.concept_id = uca.concept_id AND pc.cluster_index = uca.cluster_index
             WHERE uca.user_id = $1`,
            [userId]
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

        // Map concept_id to friendly names (imported from canonical config)
        const conceptNames = CONCEPT_NAMES

        // Detect cold start: check real-user pool size per concept.
        // If the user has submitted data but the pool is below MIN_CLUSTER_USERS,
        // include a coldStart entry so the frontend shows the placeholder.
        const MIN_CLUSTER_USERS = 10

        const [poolSizes, userHasData] = await Promise.all([
            getConceptPoolSizes(7),
            getUserConceptDataSet(userId)
        ])

        const scoredConceptIds = new Set(rows.map(r => r.concept_id))

        const scores = rows.map(row => ({
            conceptId: row.concept_id,
            conceptName: conceptNames[row.concept_id] || row.concept_id,
            score: parseFloat(row.score),
            trend: row.trend,
            avg7d: row.avg_7d ? parseFloat(row.avg_7d) : null,
            breakdown: row.aspect_breakdown,
            yesterdayScore: yesterdayScores[row.concept_id] || null,
            // History breakdown preferred; fall back to previous_aspect_breakdown saved on upsert
            previousBreakdown: yesterdayBreakdowns[row.concept_id] || row.previous_aspect_breakdown || null,
            clusterLabel: clusterInfo[row.concept_id]?.clusterLabel || null,
            dialMin: clusterInfo[row.concept_id]?.dialMin || 0,
            dialCenter: clusterInfo[row.concept_id]?.dialCenter || 50,
            dialMax: clusterInfo[row.concept_id]?.dialMax || 100,
            computedAt: row.computed_at,
            coldStart: false
        }))

        // Add cold-start placeholder entries for concepts where the student has data
        // but the cohort is too small for clustering.
        for (const conceptId of CONCEPT_IDS) {
            if (!scoredConceptIds.has(conceptId) && userHasData.has(conceptId)) {
                const poolSize = poolSizes[conceptId] || 0
                if (poolSize < MIN_CLUSTER_USERS) {
                    scores.push({
                        conceptId,
                        conceptName: conceptNames[conceptId],
                        score: null,
                        trend: null,
                        avg7d: null,
                        breakdown: null,
                        yesterdayScore: null,
                        clusterLabel: null,
                        dialMin: 0,
                        dialCenter: 50,
                        dialMax: 100,
                        computedAt: null,
                        coldStart: true
                    })
                }
            }
        }

        res.json({ scores })
}))

/**
 * GET /api/scores/:conceptId
 * Get a single concept score
 */
router.get('/:conceptId', asyncRoute(async (req, res) => {
        const userId = req.session.user?.id
        if (!userId) throw Errors.UNAUTHORIZED()

        const { conceptId } = req.params

        const { rows } = await pool.query(
            `SELECT concept_id, score, trend, avg_7d, aspect_breakdown, computed_at
             FROM public.concept_scores
             WHERE user_id = $1 AND concept_id = $2`,
            [userId, conceptId]
        )

        if (rows.length === 0) throw Errors.NOT_FOUND('Score')

        const row = rows[0]
        res.json({
            conceptId: row.concept_id,
            score: parseFloat(row.score),
            trend: row.trend,
            avg7d: row.avg_7d ? parseFloat(row.avg_7d) : null,
            breakdown: row.aspect_breakdown,
            computedAt: row.computed_at
        })
}))

export default router
