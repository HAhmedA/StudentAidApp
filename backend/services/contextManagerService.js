// Context Manager Service
// Manages current chat session and orchestrates the message flow
// Handles session lifecycle, message persistence, and error handling

import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { chatCompletionWithRetry, checkAvailability } from './apiConnectorService.js'
import { assemblePrompt, assembleInitialGreetingPrompt, getSystemInstructionsForAlignment, hasStudentProfile } from './promptAssemblerService.js'
import { getAlignedResponse, quickValidation, SERVICE_UNAVAILABLE_MESSAGE, ALIGNMENT_FAILED_MESSAGE } from './alignmentService.js'
import { invalidateSummary } from './summarizationService.js'
import { hasSRLData } from './annotationService.js'
import {
    GREETING_NO_DATA_WITH_PROFILE,
    GREETING_NO_DATA_NO_PROFILE,
    GREETING_FALLBACK,
    SESSION_TIMEOUT_SECONDS
} from '../constants.js'

/**
 * Get or create an active session for a user
 * Handles session expiry and creates new session if needed
 * 
 * @param {string} userId - User ID
 * @returns {Promise<{sessionId: string, isNew: boolean}>}
 */
async function getOrCreateSession(userId) {
    // First, expire any timed-out sessions
    await pool.query(
        `UPDATE public.chat_sessions
         SET is_active = false, ended_at = NOW()
         WHERE user_id = $1 
           AND is_active = true
           AND last_activity_at < NOW() - (timeout_seconds || ' seconds')::INTERVAL`,
        [userId]
    )

    // Try to get existing active session
    const { rows: existing } = await pool.query(
        `SELECT id FROM public.chat_sessions 
         WHERE user_id = $1 AND is_active = true
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
    )

    if (existing.length > 0) {
        // Update last activity
        await pool.query(
            `UPDATE public.chat_sessions SET last_activity_at = NOW() WHERE id = $1`,
            [existing[0].id]
        )
        return { sessionId: existing[0].id, isNew: false }
    }

    // Create new session
    const { rows: newSession } = await pool.query(
        `INSERT INTO public.chat_sessions (user_id, timeout_seconds)
         VALUES ($1, $2)
         RETURNING id`,
        [userId, SESSION_TIMEOUT_SECONDS]
    )

    logger.info(`Created new chat session for user ${userId}: ${newSession[0].id}`)
    return { sessionId: newSession[0].id, isNew: true }
}

/**
 * Save a message to the database
 * 
 * @param {string} sessionId - Session ID
 * @param {string} userId - User ID
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - Message content
 * @param {Object} metadata - Additional metadata (alignment info)
 * @returns {Promise<string>} - Message ID
 */
async function saveMessage(sessionId, userId, role, content, metadata = {}) {
    const { rows } = await pool.query(
        `INSERT INTO public.chat_messages 
         (session_id, user_id, role, content, alignment_passed, alignment_retries)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [sessionId, userId, role, content, metadata.passed ?? null, metadata.retries ?? 0]
    )

    // Invalidate today's summary since we have new messages
    const today = new Date().toISOString().split('T')[0]
    await invalidateSummary(userId, today)

    return rows[0].id
}

/**
 * Get chat history for a session with pagination
 * 
 * @param {string} sessionId - Session ID
 * @param {number} limit - Max messages to return
 * @param {string} beforeId - Get messages before this ID (for pagination)
 * @returns {Promise<Array>}
 */
async function getSessionHistory(sessionId, limit = 20, beforeId = null) {
    let query = `
        SELECT id, role, content, created_at 
        FROM public.chat_messages 
        WHERE session_id = $1`
    const params = [sessionId]

    if (beforeId) {
        query += ` AND created_at < (SELECT created_at FROM public.chat_messages WHERE id = $2)`
        params.push(beforeId)
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`
    params.push(limit)

    const { rows } = await pool.query(query, params)
    // Reverse to get chronological order
    return rows.reverse()
}

/**
 * Get all sessions for a user (for history view)
 * 
 * @param {string} userId - User ID
 * @param {number} limit - Max sessions to return
 * @returns {Promise<Array>}
 */
async function getUserSessions(userId, limit = 10) {
    const { rows } = await pool.query(
        `SELECT id, is_active, created_at, ended_at, last_activity_at
         FROM public.chat_sessions 
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
    )
    return rows
}

/**
 * Send a message and get a response
 * This is the main orchestration function
 * 
 * @param {string} userId - User ID
 * @param {string} userMessage - The user's message
 * @returns {Promise<{success: boolean, response: string, sessionId: string}>}
 */
async function sendMessage(userId, userMessage) {
    try {
        // Check LLM availability first
        const { available } = await checkAvailability()
        if (!available) {
            logger.error('LLM server not available')
            return { success: false, response: SERVICE_UNAVAILABLE_MESSAGE, sessionId: null }
        }

        // Get or create session
        const { sessionId } = await getOrCreateSession(userId)

        // Save user message
        await saveMessage(sessionId, userId, 'user', userMessage)

        // Assemble prompt with all context
        const messages = await assemblePrompt(userId, sessionId, userMessage)

        // Pre-flight validation: check if context was overly truncated or empty
        if (!messages || messages.length <= 1) { // 1 means only system prompt (or even less)
            logger.warn(`Prompt assembly returned insufficient context (length ${messages?.length}). Context may be too large.`)
            // We proceed, but the LLM might struggle. This warning helps debugging.
        }

        // Get system instructions for alignment check
        const systemInstructions = await getSystemInstructionsForAlignment()

        // Generate response with alignment checking
        const result = await getAlignedResponse(
            async () => await chatCompletionWithRetry(messages),
            userMessage,
            systemInstructions
        )

        // Quick validation before saving
        const quickCheck = quickValidation(result.content)
        if (!quickCheck.passed) {
            logger.warn(`Quick validation failed: ${quickCheck.reason}`)
            result.content = ALIGNMENT_FAILED_MESSAGE
            result.passed = false
        }

        // Save assistant response
        await saveMessage(sessionId, userId, 'assistant', result.content, {
            passed: result.passed,
            retries: result.retries
        })

        // Update session activity
        await pool.query(
            `UPDATE public.chat_sessions SET last_activity_at = NOW() WHERE id = $1`,
            [sessionId]
        )

        return {
            success: true,
            response: result.content,
            sessionId
        }

    } catch (error) {
        logger.error('Error in sendMessage:', error.message)

        // Try to save the user's message even if we can't respond
        try {
            const { sessionId } = await getOrCreateSession(userId)
            await saveMessage(sessionId, userId, 'user', userMessage)
        } catch (saveError) {
            logger.error('Failed to save user message:', saveError.message)
        }

        return { success: false, response: SERVICE_UNAVAILABLE_MESSAGE, sessionId: null }
    }
}

/**
 * Generate initial greeting for a new or returning session
 * Handles cases where user has no SRL data with hardcoded responses
 * to prevent LLM hallucination
 * 
 * @param {string} userId - User ID
 * @returns {Promise<{success: boolean, greeting: string, sessionId: string}>}
 */
async function generateInitialGreeting(userId) {
    logger.chat(`generateInitialGreeting called`, { userId })

    try {
        // Get or create session
        const { sessionId, isNew } = await getOrCreateSession(userId)
        logger.chat(`Session retrieved`, { userId, sessionId, isNew })

        // Check if we already have a cached greeting for this session
        const { rows } = await pool.query(
            `SELECT initial_greeting FROM public.chat_sessions WHERE id = $1`,
            [sessionId]
        )

        if (rows[0].initial_greeting && !isNew) {
            logger.chat(`Returning cached greeting`, {
                userId,
                sessionId,
                greetingLength: rows[0].initial_greeting.length,
                greetingPreview: rows[0].initial_greeting.substring(0, 100) + '...'
            })
            return {
                success: true,
                greeting: rows[0].initial_greeting,
                sessionId
            }
        }

        // Check if user has SRL data - if not, return hardcoded message
        // This prevents LLM from hallucinating questionnaire results
        const userHasSRLData = await hasSRLData(pool, userId)
        logger.chat(`SRL data check`, { userId, userHasSRLData })

        if (!userHasSRLData) {
            // Check specifically for student profile data (not just username)
            const hasProfileData = await hasStudentProfile(userId)
            logger.chat(`No SRL data - returning hardcoded greeting`, { userId, hasProfileData })

            let noDataGreeting
            if (hasProfileData) {
                // Has profile but no SRL data
                noDataGreeting = GREETING_NO_DATA_WITH_PROFILE
            } else {
                // No profile and no SRL data
                noDataGreeting = GREETING_NO_DATA_NO_PROFILE
            }

            // Cache the greeting
            await pool.query(
                `UPDATE public.chat_sessions SET initial_greeting = $1 WHERE id = $2`,
                [noDataGreeting, sessionId]
            )

            // Save as assistant message
            await saveMessage(sessionId, userId, 'assistant', noDataGreeting, { passed: true, retries: 0 })

            logger.info(`User ${userId} has no SRL data - returned hardcoded greeting`)
            return {
                success: true,
                greeting: noDataGreeting,
                sessionId
            }
        }

        // User has SRL data - proceed with LLM-generated greeting
        logger.chat(`User has SRL data, proceeding with LLM greeting`, { userId })

        // Check LLM availability
        const { available } = await checkAvailability()
        if (!available) {
            logger.chat(`LLM unavailable for greeting`, { userId })
            return { success: true, greeting: GREETING_FALLBACK, sessionId }
        }

        // Generate new greeting using LLM (only when we have actual data)
        logger.chat(`Assembling initial greeting prompt`, { userId })
        const messages = await assembleInitialGreetingPrompt(userId)
        logger.chat(`Prompt assembled, calling LLM`, { userId, messageCount: messages.length })
        const greeting = await chatCompletionWithRetry(messages)
        logger.chat(`LLM greeting received`, { userId, greetingLength: greeting.length })

        // Cache the greeting
        await pool.query(
            `UPDATE public.chat_sessions SET initial_greeting = $1 WHERE id = $2`,
            [greeting, sessionId]
        )

        // Save as assistant message
        await saveMessage(sessionId, userId, 'assistant', greeting, { passed: true, retries: 0 })

        return {
            success: true,
            greeting,
            sessionId
        }

    } catch (error) {
        logger.error('Error generating initial greeting:', error.message)
        return { success: false, greeting: GREETING_FALLBACK, sessionId: null }
    }
}

/**
 * Manually reset/end the current session
 * 
 * @param {string} userId - User ID
 * @returns {Promise<{success: boolean, newSessionId: string}>}
 */
async function resetSession(userId) {
    try {
        // End all active sessions
        await pool.query(
            `UPDATE public.chat_sessions 
             SET is_active = false, ended_at = NOW() 
             WHERE user_id = $1 AND is_active = true`,
            [userId]
        )

        // Create a new session
        const { sessionId } = await getOrCreateSession(userId)
        logger.info(`Session reset for user ${userId}, new session: ${sessionId}`)

        return { success: true, newSessionId: sessionId }
    } catch (error) {
        logger.error('Error resetting session:', error.message)
        return { success: false, newSessionId: null }
    }
}

export {
    getOrCreateSession,
    saveMessage,
    getSessionHistory,
    getUserSessions,
    sendMessage,
    generateInitialGreeting,
    resetSession,
    SESSION_TIMEOUT_SECONDS
}
