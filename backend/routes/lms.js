// LMS Admin Routes
import { Router } from 'express'
import { randomUUID } from 'crypto'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { requireAdmin } from '../middleware/auth.js'
import { asyncRoute, Errors } from '../utils/errors.js'
import { verifyConnection, syncUserFromMoodle } from '../services/moodleService.js'
import pLimit from 'p-limit'

const router = Router()
router.use(requireAdmin)

// =============================================================================
// IN-MEMORY JOB STORE
// =============================================================================
// Lost on server restart — admin can re-trigger sync-all if needed.

/** @type {Map<string, {status: string, progress: number, total: number, synced: number, skipped: Array, startedAt: string, completedAt: string|null, error: string|null}>} */
const syncJobs = new Map()

async function runSyncJob(jobId, users) {
    const limit = pLimit(5)
    const job = syncJobs.get(jobId)
    job.status = 'running'

    const skipped = []
    let synced = 0

    await Promise.all(
        users.map(user =>
            limit(async () => {
                try {
                    const result = await syncUserFromMoodle(pool, user.id, user.email)
                    if (result.skipped) {
                        skipped.push({ email: user.email, reason: result.reason })
                        logger.info(`sync-all[${jobId}]: skipped ${user.email} (${result.reason})`)
                    } else {
                        synced++
                        logger.info(`sync-all[${jobId}]: synced ${user.email} — ${result.synced} days`)
                    }
                } catch (err) {
                    logger.error(`sync-all[${jobId}]: error for ${user.email}: ${err.message}`)
                    skipped.push({ email: user.email, reason: err.message })
                }
                job.progress = synced + skipped.length
            })
        )
    )

    job.status = 'complete'
    job.synced = synced
    job.skipped = skipped
    job.completedAt = new Date().toISOString()
    logger.info(`sync-all[${jobId}]: complete — ${synced} synced, ${skipped.length} skipped`)
}

// =============================================================================
// CONNECTION STATUS
// =============================================================================

/**
 * @swagger
 * /lms/admin/connection-status:
 *   get:
 *     summary: Check Moodle LMS connection status
 *     tags: [LMS]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         description: Connection status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 connected:        { type: boolean }
 *                 sitename:         { type: string, nullable: true }
 *                 moodleConfigured: { type: boolean }
 *       401: { description: Not authenticated }
 *       403: { description: Not an admin }
 */
router.get('/admin/connection-status', asyncRoute(async (req, res) => {
    const moodleConfigured = !!(process.env.MOODLE_BASE_URL && process.env.MOODLE_TOKEN)

    if (!moodleConfigured) {
        return res.json({ connected: false, sitename: null, moodleConfigured: false })
    }

    try {
        const { sitename, username } = await verifyConnection()
        res.json({ connected: true, sitename, username, moodleConfigured: true })
    } catch (err) {
        logger.warn(`Moodle connection check failed: ${err.message}`)
        res.json({ connected: false, sitename: null, moodleConfigured: true, error: err.message })
    }
}))

// =============================================================================
// SYNC STATUS
// =============================================================================

router.get('/admin/sync-status', asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`
        SELECT
            u.id          AS user_id,
            u.name,
            u.email,
            MAX(ls.created_at) FILTER (WHERE ls.is_simulated = false)      AS last_sync,
            COUNT(ls.session_date) FILTER (WHERE ls.is_simulated = false)  AS real_count
        FROM public.users u
        LEFT JOIN public.lms_sessions ls ON ls.user_id = u.id
        WHERE u.role = 'student'
        GROUP BY u.id, u.name, u.email
        ORDER BY u.name
    `)

    res.json(rows.map(r => ({
        userId:        r.user_id,
        name:          r.name,
        email:         r.email,
        hasMoodleData: parseInt(r.real_count || 0) > 0,
        lastSync:      r.last_sync ?? null,
    })))
}))

// =============================================================================
// BULK SYNC — BACKGROUND JOB
// =============================================================================

/**
 * POST /api/lms/admin/sync-all
 * Enqueues a background sync of all students. Returns a jobId immediately.
 * Poll GET /admin/sync-all/status/:jobId for progress.
 */
router.post('/admin/sync-all', asyncRoute(async (req, res) => {
    const { rows: users } = await pool.query(
        `SELECT id, name, email FROM public.users WHERE role = 'student' ORDER BY name`
    )

    const jobId = randomUUID()
    syncJobs.set(jobId, {
        status:      'pending',
        progress:    0,
        total:       users.length,
        synced:      0,
        skipped:     [],
        startedAt:   new Date().toISOString(),
        completedAt: null,
        error:       null,
    })

    // Fire-and-forget — do not await
    setImmediate(() => {
        runSyncJob(jobId, users).catch(err => {
            const job = syncJobs.get(jobId)
            if (job) {
                job.status = 'failed'
                job.error  = err.message
                job.completedAt = new Date().toISOString()
            }
            logger.error(`sync-all[${jobId}]: unexpected failure: ${err.message}`)
        })
    })

    logger.info(`sync-all[${jobId}]: queued for ${users.length} students`)
    res.status(202).json({ jobId, total: users.length, status: 'pending' })
}))

/**
 * GET /api/lms/admin/sync-all/status/:jobId
 * Poll for sync-all job progress.
 */
router.get('/admin/sync-all/status/:jobId', asyncRoute(async (req, res) => {
    const job = syncJobs.get(req.params.jobId)
    if (!job) throw Errors.NOT_FOUND('Sync job')
    res.json({ jobId: req.params.jobId, ...job })
}))

// =============================================================================
// SINGLE USER SYNC
// =============================================================================

/**
 * @swagger
 * /lms/admin/sync/{userId}:
 *   post:
 *     summary: Sync a single user's LMS activity from Moodle
 *     tags: [LMS]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *         description: UUID of the user to sync
 *     responses:
 *       200:
 *         description: Sync result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 synced: { type: integer, description: Number of days synced }
 *                 days:   { type: array, items: { type: string } }
 *       404: { description: User not found }
 *       401: { description: Not authenticated }
 *       403: { description: Not an admin }
 *       502: { description: Moodle API error }
 *       503: { description: Moodle not configured }
 */
router.post('/admin/sync/:userId', asyncRoute(async (req, res) => {
    const { userId } = req.params

    const { rows } = await pool.query(
        `SELECT id, email FROM public.users WHERE id = $1`,
        [userId]
    )
    if (rows.length === 0) throw Errors.NOT_FOUND('User')

    const result = await syncUserFromMoodle(pool, rows[0].id, rows[0].email)
    res.json(result)
}))

export default router
