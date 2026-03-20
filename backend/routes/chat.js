// Chat routes
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.js'
import pool from '../config/database.js'
import { asyncRoute, Errors } from '../utils/errors.js'
import {
    sendMessage,
    generateInitialGreeting,
    getSessionHistory,
    getUserSessions,
    getOrCreateSession,
    resetSession
} from '../services/contextManagerService.js'
import { checkAvailability } from '../services/apiConnectorService.js'
import { checkInputSafety } from '../services/inputGuardService.js'
import logger from '../utils/logger.js'
import { getPreferences, upsertPreferences } from '../services/chatbotPreferencesService.js'

const router = Router()
router.use(requireAuth)

// --- Rate limiters (keyed by session user id) ---
const chatMessageLimiter = rateLimit({
    windowMs: 60_000,           // 1-minute window
    max: 10,                    // 10 messages per minute per user
    keyGenerator: (req) => req.session?.user?.id || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many messages — please wait a moment before sending again.' }
})

const chatResetLimiter = rateLimit({
    windowMs: 60_000,
    max: 3,                     // 3 resets per minute per user
    keyGenerator: (req) => req.session?.user?.id || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many resets — please wait before trying again.' }
})

/**
 * @swagger
 * /chat/session:
 *   get:
 *     summary: Get or create the active chat session for the current user
 *     tags: [Chat]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         description: Session info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessionId: { type: string }
 *                 isNew:     { type: boolean }
 *       401: { description: Not authenticated }
 */
router.get('/session', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { sessionId, isNew } = await getOrCreateSession(userId)
    res.json({ sessionId, isNew })
}))

router.get('/initial', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { sessionId, isNew } = await getOrCreateSession(userId)

    if (!isNew) {
        const recentMessages = await getSessionHistory(sessionId, 10)
        if (recentMessages.length > 0) {
            return res.json({ greeting: null, messages: recentMessages, sessionId, hasExistingSession: true, success: true })
        }
    }

    const result = await generateInitialGreeting(userId)
    res.json({
        greeting: result.greeting,
        messages: null,
        sessionId: result.sessionId,
        hasExistingSession: false,
        suggestedPrompts: result.suggestedPrompts,
        success: result.success
    })
}))

/**
 * @swagger
 * /chat/message:
 *   post:
 *     summary: Send a message to the AI chatbot
 *     tags: [Chat]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, maxLength: 5000 }
 *     responses:
 *       200:
 *         description: AI response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 response:         { type: string }
 *                 sessionId:        { type: string }
 *                 suggestedPrompts: { type: array, items: { type: string } }
 *                 success:          { type: boolean }
 *       400: { description: Missing or invalid message }
 *       401: { description: Not authenticated }
 *       500: { description: Server error }
 */
router.post('/message', chatMessageLimiter, asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { message } = req.body

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: 'message is required' })
    }
    if (message.length > 5000) {
        return res.status(400).json({ error: 'message too long (max 5000 characters)' })
    }

    const guard = checkInputSafety(message)
    if (!guard.safe) {
        logger.warn('INPUT_GUARD_BLOCK', { userId, score: guard.score, flags: guard.flags })
        return res.status(400).json({
            response: "I couldn't process that request. Could you try rephrasing?",
            success: false
        })
    }

    const result = await sendMessage(userId, message.trim())
    res.json({
        response: result.response,
        sessionId: result.sessionId,
        messageId: result.messageId || null,
        suggestedPrompts: result.suggestedPrompts,
        success: result.success
    })
}))

/**
 * @swagger
 * /chat/history:
 *   get:
 *     summary: Get message history for a chat session
 *     tags: [Chat]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *       - in: query
 *         name: before
 *         schema: { type: string, description: Cursor for pagination }
 *     responses:
 *       200:
 *         description: Chat messages
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 messages: { type: array, items: { type: object } }
 *                 hasMore:  { type: boolean }
 *       400: { description: sessionId is required }
 *       401: { description: Not authenticated }
 *       403: { description: Not authorized to access this session }
 */
router.get('/history', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { sessionId, limit = 20, before } = req.query

    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' })

    // Ownership check — IDOR guard: user may only read their own sessions
    const { rows: sessionCheck } = await pool.query(
        'SELECT id FROM public.chat_sessions WHERE id = $1 AND user_id = $2',
        [sessionId, userId]
    )
    if (sessionCheck.length === 0) return res.status(403).json({ error: 'forbidden' })

    const parsedLimit = Math.min(parseInt(limit) || 20, 50)
    // Fetch one extra row to reliably detect whether more pages exist
    const messages = await getSessionHistory(sessionId, parsedLimit + 1, before || null)
    const hasMore = messages.length > parsedLimit
    if (hasMore) messages.pop() // Remove the probe row
    res.json({ messages, hasMore })
}))

router.get('/sessions', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const sessions = await getUserSessions(userId)
    res.json({ sessions })
}))

router.post('/reset', chatResetLimiter, asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const result = await resetSession(userId)

    if (!result.success) return res.status(500).json({ error: 'reset_failed' })

    const greeting = await generateInitialGreeting(userId)
    res.json({ sessionId: result.newSessionId, greeting: greeting.greeting, success: true })
}))

// LLM availability status — used by the chatbot UI to show Online/Offline
router.get('/status', asyncRoute(async (req, res) => {
    const result = await checkAvailability()
    res.json({ available: result.available, models: result.models })
}))

// Persona / style preferences
router.get('/preferences', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const prefs = await getPreferences(userId)
    res.json(prefs)
}))

router.put('/preferences', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { response_length, tone, answer_style } = req.body

    // Must supply at least one valid key
    if (response_length === undefined && tone === undefined && answer_style === undefined) {
        return res.status(400).json({ error: 'At least one preference field is required' })
    }

    try {
        const updated = await upsertPreferences(userId, { response_length, tone, answer_style })
        res.json(updated)
    } catch (err) {
        if (err.message.startsWith('Invalid ')) {
            return res.status(400).json({ error: err.message })
        }
        throw err
    }
}))

// ── Message feedback (like / dislike-flag) ──────────────────────

const VALID_FLAG_REASONS = ['inaccurate', 'inappropriate', 'irrelevant', 'harmful', 'other']

// Shared helper: verify message exists, is assistant role, belongs to user's session
async function validateAssistantMessage(messageId, userId) {
    const { rows } = await pool.query(
        `SELECT m.id, m.role
         FROM chat_messages m
         JOIN chat_sessions s ON s.id = m.session_id
         WHERE m.id = $1 AND s.user_id = $2`,
        [messageId, userId]
    )
    if (rows.length === 0) return { error: 'Message not found', status: 404 }
    if (rows[0].role !== 'assistant') return { error: 'Only assistant messages can receive feedback', status: 400 }
    return { ok: true }
}

// Flag an assistant message (dislike)
router.post('/messages/:messageId/flag', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { messageId } = req.params
    const { reason, comment } = req.body

    if (!reason || !VALID_FLAG_REASONS.includes(reason)) {
        return res.status(400).json({ error: `reason must be one of: ${VALID_FLAG_REASONS.join(', ')}` })
    }
    if (comment && comment.length > 1000) {
        return res.status(400).json({ error: 'comment must be 1000 characters or less' })
    }

    const check = await validateAssistantMessage(messageId, userId)
    if (check.error) return res.status(check.status).json({ error: check.error })

    // Mutual exclusivity: remove any existing like
    await pool.query(
        'DELETE FROM chat_message_likes WHERE message_id = $1 AND user_id = $2',
        [messageId, userId]
    )

    try {
        const { rows } = await pool.query(
            `INSERT INTO chat_message_flags (message_id, user_id, reason, comment)
             VALUES ($1, $2, $3, $4)
             RETURNING id, message_id, reason, comment, created_at`,
            [messageId, userId, reason, comment || null]
        )
        res.status(201).json({ flag: rows[0] })
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'You have already flagged this message' })
        }
        throw err
    }
}))

// Remove own flag (only if still pending)
router.delete('/messages/:messageId/flag', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { messageId } = req.params

    const { rows } = await pool.query(
        'SELECT id, status FROM chat_message_flags WHERE message_id = $1 AND user_id = $2',
        [messageId, userId]
    )
    if (rows.length === 0) {
        return res.status(404).json({ error: 'Flag not found' })
    }
    if (rows[0].status !== 'pending') {
        return res.status(409).json({ error: 'Cannot remove a flag that has been reviewed or dismissed' })
    }

    await pool.query('DELETE FROM chat_message_flags WHERE id = $1', [rows[0].id])
    res.json({ message: 'Flag removed' })
}))

// Like an assistant message
router.post('/messages/:messageId/like', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { messageId } = req.params

    const check = await validateAssistantMessage(messageId, userId)
    if (check.error) return res.status(check.status).json({ error: check.error })

    // Mutual exclusivity: remove any pending flag
    await pool.query(
        `DELETE FROM chat_message_flags
         WHERE message_id = $1 AND user_id = $2 AND status = 'pending'`,
        [messageId, userId]
    )

    try {
        await pool.query(
            `INSERT INTO chat_message_likes (message_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [messageId, userId]
        )
        res.status(201).json({ liked: true })
    } catch (err) {
        throw err
    }
}))

// Unlike an assistant message
router.delete('/messages/:messageId/like', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { messageId } = req.params

    const { rowCount } = await pool.query(
        'DELETE FROM chat_message_likes WHERE message_id = $1 AND user_id = $2',
        [messageId, userId]
    )
    if (rowCount === 0) {
        return res.status(404).json({ error: 'Like not found' })
    }
    res.json({ liked: false })
}))

// Get user's own feedback for a session (likes + flags, used to restore UI state)
router.get('/my-feedback', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { sessionId } = req.query

    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' })

    // Ownership check
    const { rows: sessionCheck } = await pool.query(
        'SELECT id FROM public.chat_sessions WHERE id = $1 AND user_id = $2',
        [sessionId, userId]
    )
    if (sessionCheck.length === 0) return res.status(403).json({ error: 'forbidden' })

    const [flagResult, likeResult] = await Promise.all([
        pool.query(
            `SELECT f.message_id
             FROM chat_message_flags f
             JOIN chat_messages m ON m.id = f.message_id
             WHERE m.session_id = $1 AND f.user_id = $2`,
            [sessionId, userId]
        ),
        pool.query(
            `SELECT l.message_id
             FROM chat_message_likes l
             JOIN chat_messages m ON m.id = l.message_id
             WHERE m.session_id = $1 AND l.user_id = $2`,
            [sessionId, userId]
        )
    ])

    res.json({
        flaggedMessageIds: flagResult.rows.map(r => r.message_id),
        likedMessageIds: likeResult.rows.map(r => r.message_id)
    })
}))

// Legacy endpoint — kept for backward compatibility
router.get('/my-flags', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { sessionId } = req.query

    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' })

    const { rows: sessionCheck } = await pool.query(
        'SELECT id FROM public.chat_sessions WHERE id = $1 AND user_id = $2',
        [sessionId, userId]
    )
    if (sessionCheck.length === 0) return res.status(403).json({ error: 'forbidden' })

    const { rows } = await pool.query(
        `SELECT f.message_id
         FROM chat_message_flags f
         JOIN chat_messages m ON m.id = f.message_id
         WHERE m.session_id = $1 AND f.user_id = $2`,
        [sessionId, userId]
    )
    res.json({ flaggedMessageIds: rows.map(r => r.message_id) })
}))

export default router
