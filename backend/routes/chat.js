// Chat routes
// Handles chatbot API endpoints

import { Router } from 'express'
import logger from '../utils/logger.js'
import { requireAuth } from '../middleware/auth.js'
import {
    sendMessage,
    generateInitialGreeting,
    getSessionHistory,
    getUserSessions,
    getOrCreateSession,
    resetSession
} from '../services/contextManagerService.js'

const router = Router()

// All chat routes require authentication
router.use(requireAuth)

/**
 * GET /api/chat/session
 * Get or create an active chat session
 */
router.get('/session', async (req, res) => {
    try {
        const userId = req.session.user?.id
        if (!userId) {
            return res.status(401).json({ error: 'unauthorized' })
        }

        const { sessionId, isNew } = await getOrCreateSession(userId)
        res.json({ sessionId, isNew })
    } catch (error) {
        logger.error('Get session error:', error.message)
        res.status(500).json({ error: 'server_error' })
    }
})

/**
 * GET /api/chat/initial
 * Get the initial greeting message OR existing session messages if available
 * This handles page refreshes gracefully by returning existing conversation
 */
router.get('/initial', async (req, res) => {
    try {
        const userId = req.session.user?.id
        if (!userId) {
            return res.status(401).json({ error: 'unauthorized' })
        }

        // Check if there's an existing active session with messages
        const { sessionId, isNew } = await getOrCreateSession(userId)

        if (!isNew) {
            // Existing session - check for recent messages
            const recentMessages = await getSessionHistory(sessionId, 10)

            if (recentMessages.length > 0) {
                // Return existing messages instead of generating new greeting
                return res.json({
                    greeting: null,
                    messages: recentMessages,
                    sessionId,
                    hasExistingSession: true,
                    success: true
                })
            }
        }

        // New session or empty session - generate greeting
        const result = await generateInitialGreeting(userId)
        res.json({
            greeting: result.greeting,
            messages: null,
            sessionId: result.sessionId,
            hasExistingSession: false,
            success: result.success
        })
    } catch (error) {
        logger.error('Initial greeting error:', error.message)
        res.status(500).json({
            error: 'server_error',
            greeting: "Hello! I'm here to help you with your learning journey. How can I assist you today?"
        })
    }
})

/**
 * POST /api/chat/message
 * Send a message and get a response
 */
router.post('/message', async (req, res) => {
    try {
        const userId = req.session.user?.id
        if (!userId) {
            return res.status(401).json({ error: 'unauthorized' })
        }

        const { message } = req.body
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({ error: 'message is required' })
        }

        // Limit message length
        if (message.length > 5000) {
            return res.status(400).json({ error: 'message too long (max 5000 characters)' })
        }

        const result = await sendMessage(userId, message.trim())
        res.json({
            response: result.response,
            sessionId: result.sessionId,
            success: result.success
        })
    } catch (error) {
        logger.error('Send message error:', error.message)
        res.status(500).json({
            error: 'server_error',
            response: "Please, try again later."
        })
    }
})

/**
 * GET /api/chat/history
 * Get chat history with pagination
 * Query params: limit (default 20), before (message ID for pagination)
 */
router.get('/history', async (req, res) => {
    try {
        const userId = req.session.user?.id
        if (!userId) {
            return res.status(401).json({ error: 'unauthorized' })
        }

        const { sessionId, limit = 20, before } = req.query

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        const messages = await getSessionHistory(
            sessionId,
            Math.min(parseInt(limit), 50), // Cap at 50
            before || null
        )

        res.json({ messages, hasMore: messages.length === parseInt(limit) })
    } catch (error) {
        logger.error('Get history error:', error.message)
        res.status(500).json({ error: 'server_error' })
    }
})

/**
 * GET /api/chat/sessions
 * Get all sessions for the user (for history navigation)
 */
router.get('/sessions', async (req, res) => {
    try {
        const userId = req.session.user?.id
        if (!userId) {
            return res.status(401).json({ error: 'unauthorized' })
        }

        const sessions = await getUserSessions(userId)
        res.json({ sessions })
    } catch (error) {
        logger.error('Get sessions error:', error.message)
        res.status(500).json({ error: 'server_error' })
    }
})

/**
 * POST /api/chat/reset
 * Manually reset the current session (start new conversation)
 */
router.post('/reset', async (req, res) => {
    try {
        const userId = req.session.user?.id
        if (!userId) {
            return res.status(401).json({ error: 'unauthorized' })
        }

        const result = await resetSession(userId)

        if (result.success) {
            // Generate initial greeting for the new session
            const greeting = await generateInitialGreeting(userId)
            res.json({
                sessionId: result.newSessionId,
                greeting: greeting.greeting,
                success: true
            })
        } else {
            res.status(500).json({ error: 'reset_failed' })
        }
    } catch (error) {
        logger.error('Reset session error:', error.message)
        res.status(500).json({ error: 'server_error' })
    }
})

export default router
