// Scores routes - exposes concept scores for dashboard display

/**
 * @typedef {Object} ConceptScoreResponse
 * @property {string} conceptId
 * @property {string} conceptName
 * @property {number|null} score
 * @property {'improving'|'declining'|'stable'|null} trend
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
import { getConceptPoolSizes, getUserConceptDataSet, getClusterInfoByUser } from '../services/scoring/scoreQueryService.js'

const router = Router()

// All score routes require auth
router.use(requireAuth)

/**
 * @swagger
 * /scores/:
 *   get:
 *     summary: Get all concept scores for the current user
 *     tags: [Scores]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         description: Array of concept scores with cluster and dial info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 scores:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       conceptId:    { type: string }
 *                       conceptName:  { type: string }
 *                       score:        { type: number, nullable: true }
 *                       trend:        { type: string, nullable: true }
 *                       clusterLabel: { type: string, nullable: true }
 *                       dialMin:      { type: number }
 *                       dialCenter:   { type: number }
 *                       dialMax:      { type: number }
 *                       coldStart:    { type: boolean }
 *                       computedAt:   { type: string, nullable: true }
 *       401: { description: Not authenticated }
 *       500: { description: Server error }
 */
router.get('/', asyncRoute(async (req, res) => {
        const userId = req.session.user?.id
        if (!userId) throw Errors.UNAUTHORIZED()

        const { rows } = await pool.query(
            `SELECT concept_id, score, trend, aspect_breakdown, previous_aspect_breakdown, computed_at
             FROM public.concept_scores
             WHERE user_id = $1
             ORDER BY concept_id`,
            [userId]
        )

        // Get the most recent pre-today score + breakdown for each concept.
        // Using DISTINCT ON (concept_id) with ORDER BY score_date DESC instead of
        // an exact CURRENT_DATE - 1 match so the Previous needle survives missed days
        // (weekends, gaps in simulated data, etc.).
        const { rows: yesterdayRows } = await pool.query(
            `SELECT DISTINCT ON (concept_id) concept_id, score, aspect_breakdown
             FROM public.concept_score_history
             WHERE user_id = $1
               AND score_date < CURRENT_DATE
             ORDER BY concept_id, score_date DESC`,
            [userId]
        )
        const yesterdayScores = {}
        const yesterdayBreakdowns = {}
        for (const r of yesterdayRows) {
            yesterdayScores[r.concept_id] = Math.round(parseFloat(r.score) * 100) / 100
            yesterdayBreakdowns[r.concept_id] = r.aspect_breakdown || null
        }

        // Get cluster info for each concept
        const clusterInfo = await getClusterInfoByUser(userId, pool)

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
            breakdown: row.aspect_breakdown,
            yesterdayScore: yesterdayScores[row.concept_id] ?? null,
            // History breakdown preferred; fall back to previous_aspect_breakdown saved on upsert
            previousBreakdown: yesterdayBreakdowns[row.concept_id] || row.previous_aspect_breakdown || null,
            clusterLabel: clusterInfo[row.concept_id]?.clusterLabel || null,
            clusterIndex: clusterInfo[row.concept_id]?.clusterIndex ?? null,
            totalClusters: clusterInfo[row.concept_id]?.totalClusters ?? null,
            percentilePosition: clusterInfo[row.concept_id]?.percentilePosition ?? null,
            clusterUserCount: clusterInfo[row.concept_id]?.clusterUserCount ?? null,
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
            `SELECT concept_id, score, trend, aspect_breakdown, computed_at
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
            breakdown: row.aspect_breakdown,
            computedAt: row.computed_at
        })
}))

export default router
